import Foundation

/// Какие алармы включены: { id: true/false }. Хранится в UserDefaults, передаётся интерфейсу.
/// Сами условия и пороги — в web/src/domain/alarms.ts; здесь только безопасное хранение выбора.
public enum AlarmPreferences {
    public static let defaultsKey = "alarmsEnabled"
    private static let maxEntries = 64

    /// Оставляет только ключи вида snake_case (до 40 символов) с булевыми значениями.
    public static func sanitize(_ raw: Any?) -> [String: Bool] {
        guard let dict = raw as? [String: Any] else { return [:] }
        var out: [String: Bool] = [:]
        for (key, value) in dict where out.count < maxEntries && isValidID(key) {
            // Bool и из JS, и из UserDefaults приходит как CFBoolean; числа 0/1 не принимаем.
            if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
                out[key] = number.boolValue
            }
        }
        return out
    }

    static func isValidID(_ id: String) -> Bool {
        guard !id.isEmpty, id.count <= 40 else { return false }
        return id.unicodeScalars.allSatisfy { ("a" ... "z").contains($0) || $0 == "_" || ("0" ... "9").contains($0) }
    }

    public static func load(from defaults: UserDefaults = .standard) -> [String: Bool] {
        sanitize(defaults.dictionary(forKey: defaultsKey))
    }

    public static func save(_ value: [String: Bool], to defaults: UserDefaults = .standard) {
        defaults.set(value, forKey: defaultsKey)
    }
}
