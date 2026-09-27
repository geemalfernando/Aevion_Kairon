import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kairon_mobile/data/api.dart';
import 'package:kairon_mobile/data/models.dart';
import 'package:kairon_mobile/screens/driver/stop.dart';
import 'package:kairon_mobile/state/app_state.dart';
import 'package:kairon_mobile/theme.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

AppState offlineDriver() {
  final s = AppState()
    ..user = demoUsers['driver@kairon.demo']
    ..trips = seedTrips().where((t) => t.vehicleId == 'VEH014').toList()
    ..simulateOffline = true
    ..ready = true;
  s.trips.first.status = TripStatus.inProgress;
  return s;
}

Future<void> settle(AppState s) async {
  await Future<void>.delayed(const Duration(milliseconds: 50));
  while (s.syncing) {
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    // flutter_map's on-disk tile cache asks path_provider for a folder.
    TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => Directory.systemTemp.path,
    );
  });

  testWidgets('driver completes a delivery with signature while offline', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.6;
    addTearDown(tester.view.reset);
    final s = offlineDriver();
    final trip = s.trips.first;
    final stop = trip.stops.first;

    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: s,
      child: MaterialApp(theme: buildTheme(Brightness.light), home: StopScreen(tripId: trip.id, orderId: stop.orderId)),
    ));
    await tester.pump(const Duration(milliseconds: 500));

    await tester.tap(find.text('I’ve arrived'));
    await tester.pump(const Duration(milliseconds: 600));
    expect(stop.status, StopStatus.arrived);

    await tester.tap(find.text('Begin delivery'));
    await tester.pump(const Duration(milliseconds: 600));
    await tester.tap(find.text('Delivered in full'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Confirm items'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(find.widgetWithText(TextField, 'Receiver name'), 'Dilini');
    await tester.pump();

    final pad = find.text('Sign here');
    await tester.ensureVisible(pad);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.runAsync(() async {
      final g = await tester.startGesture(tester.getCenter(pad) - const Offset(80, 0));
      for (var i = 0; i < 10; i++) {
        await g.moveBy(const Offset(16, 4));
      }
      await g.up();
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Signed ✓'), findsOneWidget);

    final knob = find.byIcon(Icons.inventory_rounded);
    await tester.ensureVisible(knob);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.drag(knob, const Offset(900, 0));
    await tester.pump(const Duration(milliseconds: 800));

    expect(stop.status, StopStatus.delivered);
    expect(stop.receiver, 'Dilini');
    expect(stop.offline, isTrue);
    expect(s.outbox.map((e) => e.type), containsAll(['ARRIVE', 'DELIVER', 'PROOF_SIGNATURE']));
    expect(find.text('Delivered'), findsOneWidget);
    expect(find.textContaining('Recorded offline'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
  });

  test('offline work syncs, and a reassigned stop delivered offline is kept', () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    final api = MockKaironApi();
    final s = AppState(api: api);
    s.netOnline = true;
    await s.signIn('driver@kairon.demo', demoPassword);
    await api.markLoaded('TRP-014-1');
    await s.sync();
    s.record('START_ROUTE', 'TRP-014-1');
    await settle(s);

    s.setSimulateOffline(true);
    final t = s.myTrip!;
    final second = t.stops[1];
    s.record('ARRIVE', t.id, orderId: second.orderId);
    s.record('DELIVER', t.id, orderId: second.orderId, data: {'outcome': 'DELIVERED', 'receiver': 'Ishara', 'offline': true});
    expect(s.pending, 2);

    // Meanwhile the dispatcher moves that same stop to another vehicle.
    expect(await api.reassignOneStop(t.id), second.outletId);

    s.setSimulateOffline(false);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    while (s.syncing) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    expect(s.pending, 0);
    expect(s.conflict, isNotNull);
    expect(s.conflict!.deliveredOffline, contains(second.outletId));

    final server = await api.assignments(s.user!);
    final kept = server.first.stops.firstWhere((x) => x.orderId == second.orderId);
    expect(kept.status, StopStatus.delivered);
    expect(kept.receiver, 'Ishara');
  });

  test('photo upload failure is retried without redoing the delivery', () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    final api = MockKaironApi();
    final s = AppState(api: api)..netOnline = true;
    await s.signIn('driver@kairon.demo', demoPassword);
    s.setSimulateOffline(true);
    s.setFlaky(true);
    s.record('PROOF_PHOTO', 'TRP-014-1', orderId: 'ORD1429', data: {'path': '/tmp/p.jpg'});
    s.setSimulateOffline(false);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    while (s.syncing) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    expect(s.failed, 1);
    expect(s.status, NetStatus.error);
    await s.retry();
    expect(s.failed, 0);
    expect(s.outbox, isEmpty);
  });
}
