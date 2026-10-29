use anyhow::Result;
use std::path::Path;

pub struct Cleaner;

impl Cleaner {
    /// Move a file or directory to the system Trash (Recycle Bin).
    ///
    /// This is a recoverable delete: nothing is removed permanently, so a user
    /// can restore anything from the Trash if it was removed by mistake.
    ///
    /// On macOS the Trash is reached through `NSFileManager` directly. The
    /// crate's default asks Finder over AppleScript, which makes macOS show an
    /// "allow control of Finder" prompt and can repeat it for every file.
    pub fn delete_file(path: &Path) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            let mut ctx = trash::TrashContext::default();
            ctx.set_delete_method(DeleteMethod::NsFileManager);
            ctx.delete(path)?;
        }
        #[cfg(not(target_os = "macos"))]
        trash::delete(path)?;
        Ok(())
    }
}
