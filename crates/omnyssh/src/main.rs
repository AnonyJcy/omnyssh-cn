use clap::Parser;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

mod app;
mod cli;
mod event;
mod keybindings;
mod term_input;
mod ui;
mod utils;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = cli::Cli::parse();

    // Initialise logging. Output goes to a log file instead of stderr to prevent
    // log messages from bleeding through the TUI interface.
    // Set RUST_LOG or pass -v to enable debug output.
    let log_level = if cli.verbose { "debug" } else { "warn" };

    // Create log directory if it doesn't exist
    let log_dir = dirs::config_dir()
        .map(|d| d.join("omnyssh"))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("Warning: Failed to create log directory: {}", e);
    }

    // Prune stale rolling log files so they don't accumulate indefinitely.
    let pruned_logs = omnyssh_core::utils::platform::cleanup_old_logs(
        &log_dir,
        omnyssh_core::utils::platform::LOG_RETENTION_DAYS,
    );

    // Use daily rolling file appender
    // IMPORTANT: _guard must live for the entire duration of the program.
    // If it's dropped, logs will stop being written to the file.
    let file_appender = tracing_appender::rolling::daily(&log_dir, "omnyssh.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // russh dumps auth packets, login passwords included: its client auth code
    // at debug, every packet it writes at trace. Kept out whatever -v or
    // RUST_LOG ask for.
    let no_secrets = tracing_subscriber::filter::filter_fn(|meta| {
        let (target, level) = (meta.target(), *meta.level());
        !(target.starts_with("russh::client::encrypted") && level > tracing::Level::INFO
            || target.starts_with("russh::session") && level > tracing::Level::DEBUG)
    });
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level)),
        )
        .with_writer(non_blocking)
        .finish()
        .with(no_secrets)
        .init();

    if pruned_logs > 0 {
        tracing::debug!("Pruned {} stale log file(s)", pruned_logs);
    }

    // Restore the terminal if a panic occurs so the user is not left with a
    // broken shell.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Best-effort terminal restore — ignore errors here.
        let _ = crossterm::terminal::disable_raw_mode();
        let _ = crossterm::execute!(
            std::io::stdout(),
            crossterm::terminal::LeaveAlternateScreen,
            utils::mouse::DisableMinimalMouseCapture,
        );
        default_hook(info);
    }));

    // Load application config.
    // A missing file is silently ignored; a malformed file is reported and
    // we fall back to defaults so the app always starts.
    let mut app_config =
        match omnyssh_core::config::app_config::load_app_config(cli.config.as_deref()) {
            Ok(cfg) => {
                if let Some(ref path) = cli.config {
                    tracing::info!("Loaded config from: {}", path.display());
                }
                cfg
            }
            Err(e) => {
                tracing::warn!("Config load error (using defaults): {}", e);
                omnyssh_core::config::app_config::AppConfig::default()
            }
        };

    // Apply CLI theme override if provided and save it to config.
    if let Some(ref theme) = cli.theme {
        if omnyssh_core::config::app_config::UiConfig::is_valid_theme(theme) {
            tracing::info!("Applying theme '{}' and saving to config", theme);
            app_config.ui.theme = theme.clone();

            // Save theme to config file for persistence
            if let Err(e) = omnyssh_core::config::app_config::save_theme_to_config(theme) {
                eprintln!("Warning: Failed to save theme to config: {}", e);
                eprintln!("Theme will be applied for this session only.");
            } else {
                eprintln!("✓ Theme '{}' saved to config", theme);
            }
        } else {
            eprintln!(
                "Error: Unknown theme '{}'. Available themes: {}",
                theme,
                omnyssh_core::config::app_config::UiConfig::available_themes().join(", ")
            );
            eprintln!(
                "Falling back to theme from config: '{}'",
                app_config.ui.theme
            );
        }
    }

    let mut app = app::App::new(app_config);
    let result = app.run().await;

    // Keep the guard alive until the very end to ensure all logs are flushed
    drop(_guard);

    result
}
