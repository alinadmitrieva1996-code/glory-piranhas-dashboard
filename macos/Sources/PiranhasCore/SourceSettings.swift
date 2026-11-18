import Foundation

/// Куда ходить за данными: ссылка на развёрнутый Apps Script таблицы и секретный ключ.
public struct SourceSettings: Equatable, Sendable {
    public var endpoint: String
    public var key: String

    public init(endpoint: String, key: String) {
        self.endpoint = endpoint
        self.key = key
    }

    public var isComplete: Bool {
        !endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Ссылка запроса: endpoint + ?key=… (ключ в ссылке не дублируется).
    public func requestURL() throws -> URL {
        let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty
        else { throw DataSourceError.invalidEndpoint }
        var items = (components.queryItems ?? []).filter { $0.name != "key" }
        items.append(URLQueryItem(name: "key", value: key.trimmingCharacters(in: .whitespacesAndNewlines)))
        components.queryItems = items
        guard let url = components.url else { throw DataSourceError.invalidEndpoint }
        return url
    }
}
