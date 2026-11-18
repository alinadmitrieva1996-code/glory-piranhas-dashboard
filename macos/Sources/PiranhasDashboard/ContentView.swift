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
                alarms: model.alarmsEnabled,
                benches: model.benchOverrides
            ),
            onAction: { action in
                Task { @MainActor in
                    switch action {
                    case .refresh: await model.refresh()
                    case .settings: model.showSettings = true
                    case let .setAlarms(raw): model.setAlarms(raw)
                    case let .setBenches(raw): model.setBenches(raw)
                    }
                }
            }
        )
        .frame(minWidth: 900, minHeight: 600)
        .background(Color(red: 0x0F / 255, green: 0x11 / 255, blue: 0x13 / 255))
        .preferredColorScheme(.dark)
        .sheet(isPresented: $model.showSettings) {
            SettingsView(
                initial: model.settings,
                onSave: { model.save(settings: $0) },
                onCancel: { model.showSettings = false }
            )
        }
    }
}
