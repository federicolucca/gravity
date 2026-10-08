//! File uploads from a client, for a prompt to reference.
//!
//! A remote client cannot hand a bot a local path, so the bytes travel over
//! the socket in base64 chunks (a frame is capped at 1 MiB) and land under
//! `<gravity home>/uploads/<bot id>/`. The reply is the absolute path the
//! prompt then names; Claude Code reads it like any other file.

use std::fs;
use std::io::Write;

use base64::Engine;
use serde_json::{json, Value};

use super::Conn;

/// Largest file one upload may grow to.
const MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;

/// Longest kept file name, after sanitising.
const MAX_NAME_CHARS: usize = 80;

/// Letters, digits, `.`, `-` and `_` only, so the name is safe in a path and
/// in a prompt; anything else becomes `_`.
fn sanitize(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .take(MAX_NAME_CHARS)
        .collect();
    let clean = clean.trim_start_matches('.');
    if clean.is_empty() {
        "file".to_string()
    } else {
        clean.to_string()
    }
}

/// A continuation names a file this bot's upload directory already holds.
fn is_own_file(name: &str) -> bool {
    !name.is_empty() && sanitize(name) == name
}

impl Conn {
    /// `upload_file {bot_id, name, data}` starts a file; passing the returned
    /// `file` again appends the next chunk to it.
    pub(super) fn upload_file(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let data = Self::str_field(req, "data")?;
        self.app
            .db
            .get_bot(bot_id)?
            .ok_or_else(|| anyhow::anyhow!("bot not found"))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| anyhow::anyhow!("'data' is not base64"))?;
        let dir = crate::paths::external::uploads_dir(&self.app.cfg.home, bot_id);
        fs::create_dir_all(&dir)?;
        let file = match req.get("file").and_then(Value::as_str) {
            Some(existing) => {
                anyhow::ensure!(is_own_file(existing), "invalid 'file'");
                existing.to_string()
            }
            None => {
                let name = sanitize(Self::str_field(req, "name")?);
                format!("{}-{name}", chrono::Utc::now().format("%Y%m%d-%H%M%S%3f"))
            }
        };
        let path = dir.join(&file);
        let appending = req.get("file").is_some();
        anyhow::ensure!(!appending || path.is_file(), "unknown 'file'");
        let current = if appending { fs::metadata(&path)?.len() } else { 0 };
        anyhow::ensure!(
            current + bytes.len() as u64 <= MAX_UPLOAD_BYTES,
            "file exceeds the {} MiB upload limit",
            MAX_UPLOAD_BYTES >> 20
        );
        let mut out = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        out.write_all(&bytes)?;
        self.send(json!({
            "type": "uploaded", "req_id": req_id, "file": file,
            "path": path.to_string_lossy()
        }));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_keeps_a_safe_base_name() {
        assert_eq!(sanitize("../../etc/passwd"), "passwd");
        assert_eq!(sanitize("C:\\Users\\me\\Screen Shot (1).png"), "Screen_Shot__1_.png");
        assert_eq!(sanitize(".hidden"), "hidden");
        assert_eq!(sanitize(""), "file");
    }

    #[test]
    fn continuation_must_be_a_plain_name() {
        assert!(is_own_file("20261008-1-a.png"));
        assert!(!is_own_file("../x"));
        assert!(!is_own_file("a b"));
    }
}
