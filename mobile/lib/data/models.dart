/// Plain data classes with JSON round-tripping so everything can live on the
/// device while offline.
library;

enum Role { driver, loader }

class AppUser {
  AppUser({required this.name, required this.email, required this.role, required this.depot, this.vehicleId});
  final String name, email, depot;
  final Role role;
  final String? vehicleId;

  Map<String, dynamic> toJson() => {'name': name, 'email': email, 'role': role.name, 'depot': depot, 'vehicleId': vehicleId};
  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(name: j['name'], email: j['email'], role: Role.values.byName(j['role']), depot: j['depot'], vehicleId: j['vehicleId']);
}

class Item {
  Item(this.name, this.unit, this.qty);
  final String name, unit;
  final int qty;
  Map<String, dynamic> toJson() => {'name': name, 'unit': unit, 'qty': qty};
  factory Item.fromJson(Map<String, dynamic> j) => Item(j['name'], j['unit'], j['qty']);
}

enum StopStatus { pending, arrived, delivered, partial, failed }

class Shortfall {
  Shortfall(this.item, this.missing, this.reason);
  final String item, reason;
  final int missing;
  Map<String, dynamic> toJson() => {'item': item, 'missing': missing, 'reason': reason};
  factory Shortfall.fromJson(Map<String, dynamic> j) => Shortfall(j['item'], j['missing'], j['reason']);
}

class Stop {
  Stop({
    required this.orderId,
    required this.outletId,
    required this.outletName,
    required this.district,
    required this.windowStart,
    required this.windowEnd,
    required this.eta,
    required this.serviceMin,
    required this.chilled,
    required this.items,
    required this.x,
    required this.y,
    double? lat,
    double? lng,
    this.mall = false,
    this.status = StopStatus.pending,
    Map<String, int>? loaded,
  })  : loaded = loaded ?? {},
        // Fallback keeps older saved data on the map around Colombo.
        lat = lat ?? 6.95 - y * 0.1,
        lng = lng ?? 79.85 + x * 0.1;

  final String orderId, outletId, outletName, district;
  final int windowStart, windowEnd, eta, serviceMin; // minutes since midnight
  final bool chilled, mall;
  final List<Item> items;
  final double x, y; // 0..1 position on the drawn route diagram
  final double lat, lng; // real location for OpenStreetMap

  StopStatus status;
  int? arrivedAt, completedAt;
  String? outcome, receiver, notes, photoPath, signature;
  bool offline = false;
  Map<String, int> loaded;
  Shortfall? shortfall;

  bool get done => status == StopStatus.delivered || status == StopStatus.partial || status == StopStatus.failed;
  bool get late => eta > windowEnd;

  /// Fresh stores must have their delivery completed before 08:00.
  static const freshDeadline = 480;
  int get units => items.fold(0, (s, i) => s + i.qty);
  bool get loadConfirmed => items.every((i) => loaded.containsKey(i.name));

  Map<String, dynamic> toJson() => {
        'orderId': orderId,
        'outletId': outletId,
        'outletName': outletName,
        'district': district,
        'windowStart': windowStart,
        'windowEnd': windowEnd,
        'eta': eta,
        'serviceMin': serviceMin,
        'chilled': chilled,
        'mall': mall,
        'items': items.map((e) => e.toJson()).toList(),
        'x': x,
        'y': y,
        'lat': lat,
        'lng': lng,
        'status': status.name,
        'arrivedAt': arrivedAt,
        'completedAt': completedAt,
        'outcome': outcome,
        'receiver': receiver,
        'notes': notes,
        'photoPath': photoPath,
        'signature': signature,
        'offline': offline,
        'loaded': loaded,
        'shortfall': shortfall?.toJson(),
      };

  factory Stop.fromJson(Map<String, dynamic> j) => Stop(
        orderId: j['orderId'],
        outletId: j['outletId'],
        outletName: j['outletName'],
        district: j['district'],
        windowStart: j['windowStart'],
        windowEnd: j['windowEnd'],
        eta: j['eta'],
        serviceMin: j['serviceMin'],
        chilled: j['chilled'],
        mall: j['mall'] ?? false,
        items: (j['items'] as List).map((e) => Item.fromJson(Map<String, dynamic>.from(e))).toList(),
        x: (j['x'] as num).toDouble(),
        y: (j['y'] as num).toDouble(),
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
        status: StopStatus.values.byName(j['status']),
        loaded: Map<String, int>.from(j['loaded'] ?? {}),
      )
        ..arrivedAt = j['arrivedAt']
        ..completedAt = j['completedAt']
        ..outcome = j['outcome']
        ..receiver = j['receiver']
        ..notes = j['notes']
        ..photoPath = j['photoPath']
        ..signature = j['signature']
        ..offline = j['offline'] ?? false
        ..shortfall = j['shortfall'] == null ? null : Shortfall.fromJson(Map<String, dynamic>.from(j['shortfall']));

  Stop clone() => Stop.fromJson(toJson());
}

enum TripStatus { planned, loading, loaded, inProgress, paused, completed }

class Trip {
  Trip({
    required this.id,
    required this.vehicleId,
    required this.vehicleType,
    required this.driver,
    required this.number,
    required this.brand,
    required this.district,
    required this.departure,
    required this.stops,
    this.status = TripStatus.planned,
    List<Stop>? reassigned,
  }) : reassigned = reassigned ?? [];

  final String id, vehicleId, vehicleType, driver, brand, district;
  final int number, departure;
  List<Stop> stops;

  /// Stops the dispatcher moved to another vehicle (kept so offline deliveries can still land).
  List<Stop> reassigned;
  TripStatus status;
  String? issue;

  bool get reefer => vehicleType.toLowerCase().contains('reefer');
  int get doneCount => stops.where((s) => s.done).length;
  Stop? get nextStop {
    for (final s in stops) {
      if (!s.done) return s;
    }
    return null;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'vehicleId': vehicleId,
        'vehicleType': vehicleType,
        'driver': driver,
        'number': number,
        'brand': brand,
        'district': district,
        'departure': departure,
        'stops': stops.map((e) => e.toJson()).toList(),
        'reassigned': reassigned.map((e) => e.toJson()).toList(),
        'status': status.name,
        'issue': issue,
      };

  factory Trip.fromJson(Map<String, dynamic> j) => Trip(
        id: j['id'],
        vehicleId: j['vehicleId'],
        vehicleType: j['vehicleType'],
        driver: j['driver'],
        number: j['number'],
        brand: j['brand'],
        district: j['district'],
        departure: j['departure'],
        stops: (j['stops'] as List).map((e) => Stop.fromJson(Map<String, dynamic>.from(e))).toList(),
        reassigned: ((j['reassigned'] ?? []) as List).map((e) => Stop.fromJson(Map<String, dynamic>.from(e))).toList(),
        status: TripStatus.values.byName(j['status']),
      )..issue = j['issue'];

  Trip clone() => Trip.fromJson(toJson());
}

/// Something that happened in the field. Queued while offline, replayed on sync.
class FieldEvent {
  FieldEvent({required this.id, required this.type, required this.tripId, this.orderId, this.data = const {}, required this.at, this.failed = false, this.error});

  final String id, type, tripId;
  final String? orderId;
  final Map<String, dynamic> data;
  final int at;
  bool failed;
  String? error;

  String describe(List<Trip> trips) {
    String out() {
      for (final t in trips) {
        for (final s in [...t.stops, ...t.reassigned]) {
          if (s.orderId == orderId) return s.outletId;
        }
      }
      return orderId ?? '';
    }

    switch (type) {
      case 'LOAD_START':
        return 'Loading started · $tripId';
      case 'LOAD_COUNT':
        return '${out()} · items counted';
      case 'SHORTFALL':
        return '${out()} · shortfall reported';
      case 'LOAD_COMPLETE':
        return 'Loading complete · $tripId';
      case 'START_ROUTE':
        return 'Route started';
      case 'ARRIVE':
        return '${out()} arrival';
      case 'DELIVER':
        return '${out()} delivery';
      case 'PROOF_PHOTO':
        return '${out()} proof photo';
      case 'PROOF_SIGNATURE':
        return '${out()} signature';
      case 'VEHICLE_ISSUE':
        return 'Vehicle issue · ${data['kind']}';
    }
    return type;
  }

  Map<String, dynamic> toJson() => {'id': id, 'type': type, 'tripId': tripId, 'orderId': orderId, 'data': data, 'at': at, 'failed': failed, 'error': error};
  factory FieldEvent.fromJson(Map<String, dynamic> j) => FieldEvent(
        id: j['id'],
        type: j['type'],
        tripId: j['tripId'],
        orderId: j['orderId'],
        data: Map<String, dynamic>.from(j['data'] ?? {}),
        at: j['at'],
        failed: j['failed'] ?? false,
        error: j['error'],
      );
}

/// Apply one field event to a list of trips. Used on the device (optimistic)
/// and by the server when the event is synchronised — same rules on both sides.
/// Returns the order id if the event landed on a stop that had been reassigned.
String? applyEvent(List<Trip> trips, FieldEvent e) {
  final trip = trips.where((t) => t.id == e.tripId).firstOrNull;
  if (trip == null) return null;
  Stop? stop;
  String? conflict;
  if (e.orderId != null) {
    stop = trip.stops.where((s) => s.orderId == e.orderId).firstOrNull;
    if (stop == null) {
      final moved = trip.reassigned.where((s) => s.orderId == e.orderId).firstOrNull;
      // Goods already handed over win over a later reassignment.
      if (moved != null && (e.type == 'DELIVER' || e.type.startsWith('PROOF'))) {
        trip.reassigned.remove(moved);
        trip.stops.add(moved);
        stop = moved;
        conflict = moved.orderId;
      }
    }
  }
  switch (e.type) {
    case 'LOAD_START':
      if (trip.status == TripStatus.planned) trip.status = TripStatus.loading;
    case 'LOAD_COUNT':
      stop?.loaded = Map<String, int>.from(e.data['counts'] as Map);
    case 'SHORTFALL':
      stop?.shortfall = Shortfall(e.data['item'], e.data['missing'], e.data['reason']);
    case 'LOAD_COMPLETE':
      trip.status = TripStatus.loaded;
    case 'START_ROUTE':
      trip.status = TripStatus.inProgress;
    case 'ARRIVE':
      if (stop != null && !stop.done) {
        stop.status = StopStatus.arrived;
        stop.arrivedAt = e.at;
      }
    case 'DELIVER':
      if (stop != null) {
        final outcome = e.data['outcome'] as String;
        stop.outcome = outcome;
        stop.status = outcome == 'DELIVERED' ? StopStatus.delivered : outcome == 'PARTIAL' ? StopStatus.partial : StopStatus.failed;
        stop.receiver = e.data['receiver'];
        stop.notes = e.data['notes'];
        stop.completedAt = e.at;
        stop.offline = e.data['offline'] == true;
      }
      if (trip.stops.every((s) => s.done)) trip.status = TripStatus.completed;
    case 'PROOF_PHOTO':
      stop?.photoPath = e.data['path'];
    case 'PROOF_SIGNATURE':
      stop?.signature = e.data['png'];
    case 'VEHICLE_ISSUE':
      trip.status = TripStatus.paused;
      trip.issue = e.data['kind'];
  }
  return conflict;
}

String hm(int minutes) => '${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';

String clock(int ts) {
  final d = DateTime.fromMillisecondsSinceEpoch(ts);
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}
