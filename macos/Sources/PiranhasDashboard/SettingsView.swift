import PiranhasCore
import SwiftUI

struct SettingsView: View {
    @State private var endpoint: String
    @State private var key: String
    private let onSave: (SourceSettings) -> Void
    private let onCancel: () -> Void

    init(initial: SourceSettings, onSave: @escaping (SourceSettings) -> Void, onCancel: @escaping () -> Void) {
        _endpoint = State(initialValue: initial.endpoint)
        _key = State(initialValue: initial.key)
        self.onSave = onSave
        self.onCancel = onCancel
    }

    private var draft: SourceSettings {
        SourceSettings(endpoint: endpoint, key: key)
    }

    private var endpointProblem: String? {
        let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        do {
            _ = try SourceSettings(endpoint: trimmed, key: "check").requestURL()
            return nil
        } catch {
            return (error as? LocalizedError)?.errorDescription
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Подключение Google Sheet")
                .font(.title2)
            Text("Вставьте ссылку на развёрнутый скрипт таблицы «Пираний» и секретный ключ из функции setup(). Пошаговая инструкция — docs/setup-google-sheet.md в репозитории.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                Text("Ссылка на скрипт").font(.headline)
                TextField("https://script.google.com/macros/s/…/exec", text: $endpoint)
                    .textFieldStyle(.roundedBorder)
                if let problem = endpointProblem {
                    Text(problem).font(.caption).foregroundStyle(.red)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Секретный ключ").font(.headline)
                SecureField("Ключ из журнала setup()", text: $key)
                    .textFieldStyle(.roundedBorder)
                Text("Хранится в связке ключей macOS.").font(.caption).foregroundStyle(.secondary)
            }

            HStack {
                Spacer()
                Button("Отмена", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Сохранить и обновить") { onSave(draft) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!draft.isComplete || endpointProblem != nil)
            }
        }
        .padding(24)
        .frame(width: 540)
    }
}
