// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PiranhasDashboard",
    platforms: [.macOS(.v13)],
    targets: [
        // Логика без UI: настройки источника, загрузка, проверка ответа, кэш. Покрыта тестами.
        .target(name: "PiranhasCore", path: "Sources/PiranhasCore"),
        // Приложение: окно SwiftUI, WKWebView с интерфейсом из web/dist, меню, Keychain.
        .executableTarget(
            name: "PiranhasDashboard",
            dependencies: ["PiranhasCore"],
            path: "Sources/PiranhasDashboard"
        ),
        .testTarget(
            name: "PiranhasCoreTests",
            dependencies: ["PiranhasCore"],
            path: "Tests/PiranhasCoreTests"
        ),
    ]
)
