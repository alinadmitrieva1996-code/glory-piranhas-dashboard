import Foundation

/// Бенчи CPD, изменённые пользователем на экране гео: { "AR": 2000 } — целые центы.
/// Значения по умолчанию живут в web/src/config.ts; здесь только сохранённые изменения.
public enum BenchPreferences {
    public static let defaultsKey = "benchOverridesCents"
    /// $100 000 — заведомо больше любого разумного бенча.
    static let maxCents = 10_000_000
    private static let maxEntries = 64

    /// Оставляет коды гео из 2–8 латинских заглавных букв/цифр и целые центы в диапазоне 1…maxCents.
    public static func sanitize(_ raw: Any?) -> [String: Int] {
        guard let dict = raw as? [String: Any] else { return [:] }
        var out: [String: Int] = [:]
        for (key, value) in dict where out.count < maxEntries && isValidGeo(key) {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { continue }
            let double = number.doubleValue
            guard double.rounded() == double, double >= 1, double <= Double(maxCents) else { continue }
            out[key] = number.intValue
        }
        return out
    }

    static func isValidGeo(_ code: String) -> Bool {
        guard (2 ... 8).contains(code.count) else { return false }
        return code.unicodeScalars.allSatisfy { ("A" ... "Z").contains($0) || ("0" ... "9").contains($0) }
    }

    public static func load(from defaults: UserDefaults = .standard) -> [String: Int] {
        sanitize(defaults.dictionary(forKey: defaultsKey))
    }

    public static func save(_ value: [String: Int], to defaults: UserDefaults = .standard) {
        defaults.set(value, forKey: defaultsKey)
    }
}
