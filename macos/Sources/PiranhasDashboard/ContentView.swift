import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        DashboardWebView(
            state: WebState(
                payloadJSON: model.payloadJSON,
                savedAt: model.savedAt,
                loading: model.isLoading,
                error: model.lastError,
                configured: model.settings.isComplete,
                alarms: model.alarmsEnabled
            ),
            onAction: { action in
                Task { @MainActor in
                    switch action {
                    case .refresh: await model.refresh()
                    case .settings: model.showSettings = true
                    case let .setAlarms(raw): model.setAlarms(raw)
                    }
                }
            }
        )
        .frame(minWidth: 760, minHeight: 560)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if model.isLoading {
                    ProgressView().controlSize(.small)
                }
                Button {
                    Task { @MainActor in await model.refresh() }
                } label: {
                    Label("Обновить", systemImage: "arrow.clockwise")
                }
                .help("Подтянуть свежие данные из Google Sheet (⌘R)")
                .disabled(model.isLoading)

                Button {
                    model.showSettings = true
                } label: {
                    Label("Подключение", systemImage: "gearshape")
                }
                .help("Ссылка на скрипт таблицы и ключ (⌘,)")
            }
        }
        .sheet(isPresented: $model.showSettings) {
            SettingsView(
                initial: model.settings,
                onSave: { model.save(settings: $0) },
                onCancel: { model.showSettings = false }
            )
        }
    }
}
