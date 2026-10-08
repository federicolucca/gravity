//! File downloads to a client: what a bot produced, for the owner to save.
//!
//! The chat view offers a download for each file path a bot's reply names.
//! Only files under that bot's own directories are served — its project's
//! shared artifacts, its uploads and the directory its session runs in — and
//! the path is canonicalised first, so `..` and symlinks cannot reach outside
//! them. Bytes go back in base64 chunks to stay under the frame cap.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};

use super::Conn;

/// Raw bytes per reply chunk.
const CHUNK_BYTES: u64 = 512 * 1024;

/// Largest file served.
const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;

/// True when `path` lies inside one of `roots`, after resolving both.
fn is_within(path: &Path, roots: &[PathBuf]) -> bool {
    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| path.starts_with(root))
}

impl Conn {
    /// `download_file {bot_id, path, offset?}` → `{data, offset, size, done}`.
    pub(super) fn download_file(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let raw = Self::str_field(req, "path")?;
        let offset = req.get("offset").and_then(Value::as_u64).unwrap_or(0);
        let bot = self
            .app
            .db
            .get_bot(bot_id)?
            .ok_or_else(|| anyhow::anyhow!("bot not found"))?;
        let workspace = PathBuf::from(&bot.workspace_path);
        let mut roots = vec![
            crate::paths::external::uploads_dir(&self.app.cfg.home, bot_id),
            crate::paths::external::run_dir(&workspace),
            workspace,
        ];
        if let Some(project) = self.app.db.get_project(&bot.project_id)? {
            roots.push(crate::paths::artifacts_dir(
                &self.app.cfg,
                &project.dir_name,
            ));
        }
        let path = Path::new(raw)
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("file not found"))?;
        anyhow::ensure!(
            path.is_file() && is_within(&path, &roots),
            "only files in this bot's folders can be downloaded"
        );
        let size = path.metadata()?.len();
        anyhow::ensure!(
            size <= MAX_DOWNLOAD_BYTES,
            "file exceeds the {} MiB download limit",
            MAX_DOWNLOAD_BYTES >> 20
        );
        let mut file = File::open(&path)?;
        file.seek(SeekFrom::Start(offset.min(size)))?;
        let mut chunk = Vec::new();
        file.take(CHUNK_BYTES).read_to_end(&mut chunk)?;
        let next = offset + chunk.len() as u64;
        self.send(json!({
            "type": "downloaded", "req_id": req_id,
            "data": base64::engine::general_purpose::STANDARD.encode(&chunk),
            "offset": next, "size": size, "done": next >= size
        }));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_outside_the_roots_are_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("bot");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.txt"), "x").unwrap();
        std::fs::write(tmp.path().join("secret.txt"), "x").unwrap();
        let roots = [root.clone()];
        let inside = root.join("a.txt").canonicalize().unwrap();
        let escaped = root.join("../secret.txt").canonicalize().unwrap();
        assert!(is_within(&inside, &roots));
        assert!(!is_within(&escaped, &roots));
    }
}
