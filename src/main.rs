mod analyzer;
mod cleaner;
mod models;
mod scanner;
mod web;

use anyhow::Result;
use clap::Parser;
use std::net::IpAddr;
use std::path::PathBuf;
use web::Settings;

/// Disk-space analyzer, system monitor and safe cleaner — all behind a local web UI.
#[derive(Parser, Debug)]
#[command(name = "spacescope", version, about)]
struct Args {
    /// Default directory pre-filled in the Cleaner (defaults to the whole disk)
    #[arg(short, long)]
    path: Option<PathBuf>,

    /// Default the Cleaner to your home directory instead of the whole disk
    #[arg(long, conflicts_with = "path")]
    home: bool,

    /// Minimum file size to list, in MB
    #[arg(short, long, default_value_t = 1)]
    min_size: u64,

    /// Directory levels to descend below the scan root (0 = unlimited)
    #[arg(short, long, default_value_t = 0)]
    depth: usize,

    /// Port for the web UI (the next free port is used if it is taken)
    #[arg(long, default_value_t = 8080)]
    port: u16,

    /// Address to listen on. Anything other than a loopback address exposes the
    /// UI — and file deletion — to your network with no authentication.
    #[arg(long, default_value = "127.0.0.1")]
    host: IpAddr,

    /// Do not open the browser automatically
    #[arg(long)]
    no_open: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let default_path = match (args.path, args.home) {
        (Some(path), _) => path,
        (None, true) => web::home_dir(),
        (None, false) => web::filesystem_root(),
    };
    let settings = Settings {
        default_path,
        min_size_mb: args.min_size,
        max_depth: args.depth,
    };

    let listener = web::bind(args.host, args.port).await?;
    let addr = listener.local_addr()?;
    let url = format!("http://{addr}");

    println!("\n  Spacescope {}", env!("CARGO_PKG_VERSION"));
    println!("  Running at {url}  (Ctrl-C to stop)\n");
    if !addr.ip().is_loopback() {
        eprintln!("  ⚠ Listening on a non-loopback address with no authentication.\n");
    }
    if addr.port() != args.port {
        eprintln!("  Port {} was busy; using {} instead.\n", args.port, addr.port());
    }

    if !args.no_open {
        if let Err(e) = open_browser(&url) {
            eprintln!("  Could not open a browser ({e}); visit {url} yourself.");
        }
    }

    web::serve(listener, settings).await
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");

    cmd.arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}
