import AppKit
import Foundation
import PiranhasCore

/// Состояние приложения: настройки источника, последние данные, загрузка и ошибки.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var payloadJSON: String?
    @Published private(set) var savedAt: Date?
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String?
    @Published private(set) var settings: SourceSettings
    @Published var showSettings = false

    private static let endpointDefaultsKey = "sheetEndpoint"
    private static let keychainAccount = "sheet-key"

    private let client = DataClient()
    private let store = SnapshotStore(directory: SnapshotStore.defaultDirectory())
    private var timer: Timer?
    private var wakeObserver: NSObjectProtocol?

    init() {
        let endpoint = UserDefaults.standard.string(forKey: Self.endpointDefaultsKey) ?? ""
        let key = Keychain.read(account: Self.keychainAccount) ?? ""
        settings = SourceSettings(endpoint: endpoint, key: key)

        if let snapshot = store.load() {
            payloadJSON = snapshot.json
            savedAt = snapshot.savedAt
        }

        // Проверяем раз в 5 минут, пора ли обновиться (фактически — раз в час).
        // Так обновление не теряется, если Mac спал в момент «круглого» часа.
        timer = Timer.scheduledTimer(withTimeInterval: 5 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshIfStale() }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshIfStale() }
        }

        if settings.isComplete {
            Task { @MainActor in await self.refresh() }
        } else {
            showSettings = true
        }
    }

    func save(settings newSettings: SourceSettings) {
        let cleaned = SourceSettings(
            endpoint: newSettings.endpoint.trimmingCharacters(in: .whitespacesAndNewlines),
            key: newSettings.key.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        UserDefaults.standard.set(cleaned.endpoint, forKey: Self.endpointDefaultsKey)
        if !Keychain.write(cleaned.key, account: Self.keychainAccount) {
            lastError = "Не удалось сохранить ключ в связке ключей macOS."
        }
        settings = cleaned
        showSettings = false
        Task { @MainActor in await self.refresh() }
    }

    func refresh() async {
        guard !isLoading else { return }
        guard settings.isComplete else {
            showSettings = true
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let json = try await client.fetch(settings)
            let now = Date()
            try? store.save(json, at: now)
            payloadJSON = json
            savedAt = now
            lastError = nil
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func refreshIfStale() {
        guard settings.isComplete, RefreshPolicy.isStale(savedAt: savedAt, now: Date()) else { return }
        Task { @MainActor in await self.refresh() }
    }
}
