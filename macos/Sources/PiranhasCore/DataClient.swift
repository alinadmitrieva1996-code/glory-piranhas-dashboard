import Foundation

public enum DataSourceError: Error, Equatable, LocalizedError {
    case notConfigured
    case invalidEndpoint
    case http(Int)
    case notJSON
    case unauthorized
    case scriptNotConfigured
    case server(String)
    case malformed

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Не заданы ссылка на скрипт таблицы и ключ."
        case .invalidEndpoint:
            return "Ссылка на скрипт должна начинаться с https://script.google.com/…"
        case let .http(code):
            return "Google ответил кодом \(code). Проверьте, что скрипт развёрнут как веб-приложение."
        case .notJSON:
            return "Вместо данных пришла страница. Обычно это значит, что у развёртывания доступ не «Все»."
        case .unauthorized:
            return "Неверный ключ. Скопируйте ключ из журнала функции setup() в скрипте таблицы."
        case .scriptNotConfigured:
            return "В скрипте таблицы ещё не создан ключ: запустите в нём функцию setup()."
        case let .server(message):
            return "Скрипт таблицы вернул ошибку: \(message)"
        case .malformed:
            return "Ответ таблицы не в том формате (нет строк rows)."
        }
    }
}

/// Проверка ответа скрипта до того, как отдать его интерфейсу.
public enum PayloadValidator {
    /// Возвращает JSON как строку, если это корректный ответ `{ ok: true, rows: [...] }`.
    public static func validate(_ data: Data) throws -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any]
        else { throw DataSourceError.notJSON }

        if let ok = dict["ok"] as? Bool, ok == false {
            let code = dict["error"] as? String ?? "unknown"
            switch code {
            case "unauthorized": throw DataSourceError.unauthorized
            case "not_configured": throw DataSourceError.scriptNotConfigured
            default:
                let message = dict["message"] as? String
                throw DataSourceError.server(message.map { "\(code): \($0)" } ?? code)
            }
        }
        guard (dict["ok"] as? Bool) == true, dict["rows"] is [Any] else { throw DataSourceError.malformed }
        guard let text = String(data: data, encoding: .utf8) else { throw DataSourceError.malformed }
        return text
    }
}

/// Загружает данные из таблицы. Редиректы Google (script.googleusercontent.com) URLSession проходит сам.
public final class DataClient {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func fetch(_ settings: SourceSettings) async throws -> String {
        guard settings.isComplete else { throw DataSourceError.notConfigured }
        let request = URLRequest(
            url: try settings.requestURL(),
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 90
        )
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
            throw DataSourceError.http(http.statusCode)
        }
        return try PayloadValidator.validate(data)
    }
}
