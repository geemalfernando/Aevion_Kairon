import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// The contract the app needs from the Kairon backend.
/// [MockKaironApi] implements it on-device until the real API is available.
abstract class KaironApi {
  Future<AppUser> signIn(String email, String password);
  Future<List<Trip>> assignments(AppUser user);
  Future<void> push(FieldEvent event, {bool flakyUploads = false});

  /// Demo helper: the dispatcher reassigns a pending stop while the driver is away.
  Future<String?> reassignOneStop(String tripId);
  Future<void> markLoaded(String tripId);
  Future<void> reset();
}

class ApiException implements Exception {
  ApiException(this.code, this.message);
  final String code, message;
  @override
  String toString() => message;
}

const demoPassword = 'kairon-demo';

final demoUsers = {
  'driver@kairon.demo': AppUser(name: 'Nimal', email: 'driver@kairon.demo', role: Role.driver, depot: 'Peliyagoda', vehicleId: 'VEH014'),
  'loader@kairon.demo': AppUser(name: 'Kamal', email: 'loader@kairon.demo', role: Role.loader, depot: 'Peliyagoda'),
};
const webOnly = {'dispatcher@kairon.demo', 'store@kairon.demo'};

Stop _stop(String order, String outlet, String name, String district, int ws, int we, int eta, bool chilled, List<Item> items, double x, double y, {bool mall = false, double? lat, double? lng}) => Stop(
      orderId: order,
      outletId: outlet,
      outletName: name,
      district: district,
      windowStart: ws,
      windowEnd: we,
      eta: eta,
      serviceMin: 10 + items.fold<int>(0, (s, i) => s + i.qty) ~/ 5,
      chilled: chilled,
      items: items,
      x: x,
      y: y,
      lat: lat,
      lng: lng,
      mall: mall,
    );

/// Real depot locations.
const depotGeo = {'Peliyagoda': (6.9606, 79.8930), 'Kandy': (7.3187, 80.6291)};

/// The same demo network the web app uses: VEH014's Fresh route through Colombo.
List<Trip> seedTrips() => [
      Trip(id: 'TRP-014-1', vehicleId: 'VEH014', vehicleType: 'Reefer truck', driver: 'Nimal', number: 1, brand: 'Fresh', district: 'Colombo', departure: 225, stops: [
        _stop('ORD1429', 'OUT032', 'Fresh Borella', 'Colombo', 300, 450, 300, true, [Item('Milk', 'crates', 12), Item('Frozen goods', 'crates', 4), Item('Produce', 'crates', 8)], 0.52, 0.30, lat: 6.9147, lng: 79.8784),
        _stop('ORD1441', 'OUT047', 'Fresh Narahenpita', 'Colombo', 300, 420, 326, true, [Item('Milk', 'crates', 9), Item('Yoghurt', 'crates', 6), Item('Dry goods', 'cartons', 5)], 0.68, 0.48, lat: 6.9003, lng: 79.8767),
        _stop('ORD1417', 'OUT018', 'Fresh Bambalapitiya', 'Colombo', 300, 450, 353, true, [Item('Milk', 'crates', 14), Item('Produce', 'crates', 7)], 0.30, 0.58, lat: 6.8894, lng: 79.8567),
        _stop('ORD1404', 'OUT004', 'Fresh Kollupitiya', 'Colombo', 300, 450, 380, true, [Item('Milk', 'crates', 8), Item('Yoghurt', 'crates', 13), Item('Frozen goods', 'crates', 5), Item('Produce', 'crates', 6)], 0.18, 0.40, lat: 6.9106, lng: 79.8513),
        _stop('ORD1449', 'OUT056', 'Fresh Kirulapone', 'Colombo', 300, 480, 414, true, [Item('Milk', 'crates', 15), Item('Yoghurt', 'crates', 6), Item('Frozen goods', 'crates', 4), Item('Produce', 'crates', 11), Item('Dry goods', 'cartons', 4)], 0.56, 0.80, lat: 6.8779, lng: 79.8783),
      ]),
      Trip(id: 'TRP-021-1', vehicleId: 'VEH021', vehicleType: 'Reefer van', driver: 'Kasun', number: 1, brand: 'Fresh', district: 'Gampaha', departure: 225, stops: [
        _stop('ORD1455', 'OUT061', 'Fresh Ja-Ela', 'Gampaha', 300, 450, 305, true, [Item('Milk', 'crates', 10), Item('Produce', 'crates', 6)], 0.4, 0.3, lat: 7.0744, lng: 79.8919),
        _stop('ORD1460', 'OUT066', 'Fresh Wattala', 'Gampaha', 270, 420, 334, false, [Item('Produce', 'crates', 9), Item('Dry goods', 'cartons', 7)], 0.6, 0.6, lat: 6.9894, lng: 79.891),
        _stop('ORD1463', 'OUT070', 'Fresh Kadawatha', 'Gampaha', 300, 480, 371, true, [Item('Milk', 'crates', 11), Item('Yoghurt', 'crates', 4)], 0.3, 0.7, lat: 7.0012, lng: 79.953),
      ]),
      Trip(id: 'TRP-008-2', vehicleId: 'VEH008', vehicleType: 'Truck', driver: 'Dilan', number: 2, brand: 'Style', district: 'Colombo', departure: 510, stops: [
        _stop('ORD1471', 'OUT077', 'Style Havelock', 'Colombo', 600, 720, 612, false, [Item('Apparel', 'cartons', 18), Item('Footwear', 'cartons', 6)], 0.3, 0.3, lat: 6.8823, lng: 79.8651),
        _stop('ORD1474', 'OUT081', 'Style Majestic Mall', 'Colombo', 600, 660, 640, false, [Item('Apparel', 'cartons', 12)], 0.6, 0.5, mall: true, lat: 6.8938, lng: 79.8553),
      ]),
      Trip(id: 'TRP-033-2', vehicleId: 'VEH033', vehicleType: 'Van', driver: 'Ruwan', number: 2, brand: 'Tech', district: 'Kalutara', departure: 735, stops: [
        _stop('ORD1480', 'OUT091', 'Tech Panadura', 'Kalutara', 840, 1020, 846, false, [Item('Electronics', 'cartons', 8), Item('Accessories', 'boxes', 14)], 0.5, 0.4, lat: 6.7132, lng: 79.9026),
        _stop('ORD1484', 'OUT095', 'Tech Horana', 'Kalutara', 780, 960, 900, false, [Item('Electronics', 'cartons', 5)], 0.7, 0.7, lat: 6.7159, lng: 80.0626),
      ]),
    ];

/// On-device stand-in for the Kairon server. It keeps its own copy of the
/// operation (separate from the device's offline copy) and adds realistic latency.
class MockKaironApi implements KaironApi {
  static const _key = 'kairon.mock-server.v2';
  final _rng = Random();

  Future<List<Trip>> _load() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_key);
    if (raw == null) return seedTrips();
    return (jsonDecode(raw) as List).map((e) => Trip.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<void> _save(List<Trip> trips) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, jsonEncode(trips.map((t) => t.toJson()).toList()));
  }

  Future<void> _latency() => Future.delayed(Duration(milliseconds: 250 + _rng.nextInt(250)));

  @override
  Future<AppUser> signIn(String email, String password) async {
    await _latency();
    final e = email.trim().toLowerCase();
    if (webOnly.contains(e)) throw ApiException('web-only', 'This mobile application is available for drivers and loaders.');
    final u = demoUsers[e];
    if (u == null || password != demoPassword) throw ApiException('bad-credentials', 'That email and password don’t match an account.');
    return u;
  }

  @override
  Future<List<Trip>> assignments(AppUser user) async {
    await _latency();
    final all = await _load();
    return user.role == Role.driver ? all.where((t) => t.vehicleId == user.vehicleId).toList() : all;
  }

  @override
  Future<void> push(FieldEvent event, {bool flakyUploads = false}) async {
    await _latency();
    if (flakyUploads && event.type == 'PROOF_PHOTO') throw ApiException('upload', 'File upload interrupted');
    final all = await _load();
    applyEvent(all, event);
    await _save(all);
  }

  @override
  Future<String?> reassignOneStop(String tripId) async {
    final all = await _load();
    final t = all.where((x) => x.id == tripId).firstOrNull;
    if (t == null) return null;
    final pending = t.stops.where((s) => !s.done).toList();
    if (pending.length < 2) return null;
    final moved = pending[1];
    t.stops.remove(moved);
    t.reassigned.add(moved);
    await _save(all);
    return moved.outletId;
  }

  @override
  Future<void> markLoaded(String tripId) async {
    final all = await _load();
    for (final t in all) {
      if (t.id == tripId && (t.status == TripStatus.planned || t.status == TripStatus.loading)) {
        t.status = TripStatus.loaded;
        for (final s in t.stops) {
          s.loaded = {for (final i in s.items) i.name: i.qty};
        }
      }
    }
    await _save(all);
  }

  @override
  Future<void> reset() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_key);
  }
}
