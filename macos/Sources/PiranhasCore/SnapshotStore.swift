import Foundation

/// Последний успешный ответ таблицы на диске: приложение открывается с цифрами даже без сети.
public struct SnapshotStore {
    public struct Snapshot: Equatable {
        public let json: String
        public let savedAt: Date
    }

    private let fileURL: URL

    public init(directory: URL) {
        fileURL = directory.appendingPathComponent("snapshot.json")
    }

    /// ~/Library/Application Support/PiranhasDashboard
    public static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("PiranhasDashboard", isDirectory: true)
    }

    public func save(_ json: String, at date: Date) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(json.utf8).write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: fileURL.path)
    }

    public func load() -> Snapshot? {
        guard let data = try? Data(contentsOf: fileURL),
              let json = String(data: data, encoding: .utf8),
              let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let date = attributes[.modificationDate] as? Date
        else { return nil }
        return Snapshot(json: json, savedAt: date)
    }
}

/// Когда пора обновляться: раз в час, а также сразу после пробуждения, если данные устарели.
public enum RefreshPolicy {
    public static let interval: TimeInterval = 60 * 60

    public static func isStale(savedAt: Date?, now: Date, interval: TimeInterval = interval) -> Bool {
        guard let savedAt else { return true }
        return now.timeIntervalSince(savedAt) >= interval
    }
}
