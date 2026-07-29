// Island is a desktop application, including during local debug builds.
// Using the Windows subsystem prevents a command prompt/Windows Terminal
// window from appearing when a user launches island.exe directly.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    island_lib::run();
}
