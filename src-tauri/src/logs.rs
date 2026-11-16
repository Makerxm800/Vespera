//! Log tail helper (port of the former logger's readTail).

use std::fs;
use std::path::Path;

pub fn read_tail(path: &Path, max_lines: usize) -> String {
    let Ok(raw) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

pub fn open_dir(path: &Path) -> Result<(), String> {
    let target = path.to_string_lossy().to_string();
    let status = if std::env::consts::OS == "windows" {
        std::process::Command::new("explorer").arg(&target).status()
    } else if std::env::consts::OS == "macos" {
        std::process::Command::new("open").arg(&target).status()
    } else {
        std::process::Command::new("xdg-open").arg(&target).status()
    };
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("Could not open the folder.".to_string()),
        Err(e) => Err(format!("Could not open the folder. ({e})")),
    }
}
