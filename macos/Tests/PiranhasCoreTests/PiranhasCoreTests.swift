import Foundation
import XCTest
@testable import PiranhasCore

final class SourceSettingsTests: XCTestCase {
    func testBuildsURLWithKey() throws {
        let s = SourceSettings(endpoint: " https://script.google.com/macros/s/ABC/exec ", key: " secret ")
        XCTAssertTrue(s.isComplete)
        XCTAssertEqual(try s.requestURL().absoluteString, "https://script.google.com/macros/s/ABC/exec?key=secret")
    }

    func testReplacesExistingKey() throws {
        let s = SourceSettings(endpoint: "https://script.google.com/macros/s/ABC/exec?key=old&x=1", key: "new")
        let url = try s.requestURL()
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.filter { $0.name == "key" }.map(\.value), ["new"])
        XCTAssertEqual(items.first { $0.name == "x" }?.value, "1")
    }

    func testRejectsHTTPAndGarbage() {
        XCTAssertThrowsError(try SourceSettings(endpoint: "http://script.google.com/x", key: "k").requestURL())
        XCTAssertThrowsError(try SourceSettings(endpoint: "не ссылка", key: "k").requestURL())
        XCTAssertFalse(SourceSettings(endpoint: "https://x", key: "  ").isComplete)
    }
}

final class PayloadValidatorTests: XCTestCase {
    func testAcceptsValidPayload() throws {
        let json = #"{"ok":true,"rows":[{"buyer":"BUYER1","date":"2026-11-16","geo":"AR","ftd":1,"spend":10}]}"#
        XCTAssertEqual(try PayloadValidator.validate(Data(json.utf8)), json)
    }

    func testMapsScriptErrors() {
        XCTAssertThrowsError(try PayloadValidator.validate(Data(#"{"ok":false,"error":"unauthorized"}"#.utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .unauthorized)
        }
        XCTAssertThrowsError(try PayloadValidator.validate(Data(#"{"ok":false,"error":"not_configured"}"#.utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .scriptNotConfigured)
        }
    }

    func testRejectsHTMLAndMissingRows() {
        XCTAssertThrowsError(try PayloadValidator.validate(Data("<html>Sign in</html>".utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .notJSON)
        }
        XCTAssertThrowsError(try PayloadValidator.validate(Data(#"{"ok":true}"#.utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .malformed)
        }
    }
}

final class SnapshotStoreTests: XCTestCase {
    func testRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = SnapshotStore(directory: dir)
        XCTAssertNil(store.load())
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        try store.save(#"{"ok":true,"rows":[]}"#, at: date)
        let snap = try XCTUnwrap(store.load())
        XCTAssertEqual(snap.json, #"{"ok":true,"rows":[]}"#)
        XCTAssertEqual(snap.savedAt.timeIntervalSince1970, date.timeIntervalSince1970, accuracy: 1)
    }

    func testRefreshPolicy() {
        let now = Date()
        XCTAssertTrue(RefreshPolicy.isStale(savedAt: nil, now: now))
        XCTAssertFalse(RefreshPolicy.isStale(savedAt: now.addingTimeInterval(-59 * 60), now: now))
        XCTAssertTrue(RefreshPolicy.isStale(savedAt: now.addingTimeInterval(-60 * 60), now: now))
    }
}

final class AlarmPreferencesTests: XCTestCase {
    func testSanitizeKeepsOnlyBooleansWithValidIDs() {
        let raw: [String: Any] = [
            "lead_not_stopped": false,
            "geo_cpd_jump": true,
            "bad id": true,
            "number_value": 1,
            "string_value": "yes",
        ]
        XCTAssertEqual(AlarmPreferences.sanitize(raw), ["lead_not_stopped": false, "geo_cpd_jump": true])
        XCTAssertEqual(AlarmPreferences.sanitize(nil), [:])
        XCTAssertEqual(AlarmPreferences.sanitize("garbage"), [:])
    }

    func testRoundTripThroughDefaults() throws {
        let suite = "alarms-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(AlarmPreferences.load(from: defaults), [:])
        AlarmPreferences.save(["data_missing": false], to: defaults)
        XCTAssertEqual(AlarmPreferences.load(from: defaults), ["data_missing": false])
    }
}

final class BenchPreferencesTests: XCTestCase {
    func testSanitizeKeepsWholeCentsForValidGeo() {
        let raw: [String: Any] = [
            "AR": 2200,
            "MY": 4000,
            "ET": 18.5,       // не целые центы
            "ar": 2000,       // код в нижнем регистре
            "XX": 0,          // ноль
            "BD": 99_000_000, // слишком много
            "NP": true,       // не число
            "PK": "2000",     // строка
        ]
        XCTAssertEqual(BenchPreferences.sanitize(raw), ["AR": 2200, "MY": 4000])
        XCTAssertEqual(BenchPreferences.sanitize(nil), [:])
    }

    func testRoundTripThroughDefaults() throws {
        let suite = "bench-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(BenchPreferences.load(from: defaults), [:])
        BenchPreferences.save(["AR": 2150], to: defaults)
        XCTAssertEqual(BenchPreferences.load(from: defaults), ["AR": 2150])
    }
}
