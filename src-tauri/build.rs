/**
 * build.rs — embeds the guest bridge script (src/shared/guest-bridge.js) into
 * the binary as a compile-time constant. The proxy injects this exact script
 * into every proxied page, so the Tauri app and the browser preview share one
 * source of truth.
 *
 * The JS exports `bridgeScript()` whose body is a template literal with a single
 * `${config}` interpolation; we replace it with a `__VESPERA_CONFIG__`
 * placeholder that src/proxy.rs substitutes at runtime with the JSON config.
 */
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Embed the Windows resources: application manifest (Common-Controls v6 —
    // required because the dialog stack imports TaskDialogIndirect from
    // comctl32 v6), icon and version info. Without this call the exe has no
    // manifest, Windows loads comctl32 v5, and the app dies at startup with
    // "The procedure entry point TaskDialogIndirect could not be located".
    tauri_build::build();

    println!("cargo:rerun-if-changed=../src/shared/guest-bridge.js");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let bridge_path = manifest_dir.join("../src/shared/guest-bridge.js");
    let source = fs::read_to_string(&bridge_path).expect("src/shared/guest-bridge.js must exist");

    let start_marker = "return `";
    let start = source
        .find(start_marker)
        .expect("guest-bridge.js must contain the bridge template literal");
    let content_start = start + start_marker.len();

    // The template literal ends at the next unescaped backtick.
    let mut end = content_start;
    let bytes = source.as_bytes();
    let mut escaped = false;
    while end < bytes.len() {
        let c = bytes[end];
        if escaped {
            escaped = false;
        } else if c == b'\\' {
            escaped = true;
        } else if c == b'`' {
            break;
        }
        end += 1;
    }
    let mut template = source[content_start..end].to_string();

    if !template.contains("__VESPERA_CONFIG__") {
        template = template.replace("${config}", "__VESPERA_CONFIG__");
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("bridge_script.txt"), template).expect("failed to write bridge_script.txt");
}
