import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../theme.dart';

/// OpenStreetMap tiles recoloured to the Kairon palette:
/// monochrome, tinted towards Stormy Teal (light) or deep teal (dark).
Widget _tintedTiles(BuildContext context) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  // Luminance → teal-tinted greys; dark mode dims to deep teal.
  final m = dark
      ? <double>[
          0.06, 0.12, 0.02, 0, 4, //
          0.09, 0.18, 0.03, 0, 8,
          0.10, 0.19, 0.04, 0, 10,
          0, 0, 0, 1, 0,
        ]
      : <double>[
          0.20, 0.55, 0.08, 0, 22, //
          0.22, 0.60, 0.09, 0, 34,
          0.22, 0.58, 0.09, 0, 34,
          0, 0, 0, 1, 0,
        ];
  return TileLayer(
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    userAgentPackageName: 'com.kairon.kairon_mobile',
    maxZoom: 19,
    tileBuilder: (context, tile, _) => ColorFiltered(colorFilter: ColorFilter.matrix(m), child: tile),
  );
}

Widget _attribution(BuildContext context) => Positioned(
      right: 6,
      bottom: 6,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: context.k.surface.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6)),
        child: Text('© OpenStreetMap', style: TextStyle(fontSize: 9, color: context.k.muted)),
      ),
    );

Widget _offlineChip(BuildContext context) => Positioned(
      left: 10,
      top: 10,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: context.k.ink, borderRadius: BorderRadius.circular(99)),
        child: Text('Offline · map tiles may be missing, stops still shown', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: context.k.bg)),
      ),
    );

LatLng _depot(String? name) {
  final d = depotGeo[name ?? 'Peliyagoda'] ?? depotGeo['Peliyagoda']!;
  return LatLng(d.$1, d.$2);
}

class _DepotMarker extends StatelessWidget {
  const _DepotMarker();
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: K.chocolate,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6, offset: Offset(0, 2))],
        ),
        child: const Icon(Icons.warehouse_rounded, color: Colors.white, size: 18),
      );
}

class _StopMarker extends StatelessWidget {
  const _StopMarker({required this.n, required this.stop, required this.current});
  final int n;
  final Stop stop;
  final bool current;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final done = stop.done;
    final color = stop.status == StopStatus.failed ? k.attention : k.brand;
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? color : k.surface,
        border: Border.all(color: current ? k.info : color, width: current ? 3.5 : 3),
        boxShadow: [BoxShadow(color: (current ? k.info : Colors.black).withValues(alpha: current ? 0.45 : 0.3), blurRadius: current ? 12 : 6)],
      ),
      alignment: Alignment.center,
      child: done
          ? Icon(stop.status == StopStatus.failed ? Icons.priority_high_rounded : Icons.check_rounded, size: 16, color: Colors.white)
          : Text('$n', style: TextStyle(fontFamily: K.mono, fontWeight: FontWeight.w700, fontSize: 13, color: current ? k.info : k.ink)),
    );
  }
}

class _Truck extends StatelessWidget {
  const _Truck();
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: context.k.info,
          border: Border.all(color: Colors.white, width: 2.5),
          boxShadow: [BoxShadow(color: context.k.info.withValues(alpha: 0.5), blurRadius: 14, spreadRadius: 2)],
        ),
        child: const Icon(Icons.local_shipping_rounded, color: Colors.white, size: 15),
      );
}

/// A driver's route on OpenStreetMap: depot, numbered stops, travelled and
/// planned legs, and a truck easing along the current leg.
class OsmRouteMap extends StatefulWidget {
  const OsmRouteMap({super.key, required this.stops, required this.nextIndex, this.depot, this.height = 240, this.moving = true});
  final List<Stop> stops;
  final int nextIndex;
  final String? depot;
  final double height;
  final bool moving;
  @override
  State<OsmRouteMap> createState() => _OsmRouteMapState();
}

class _OsmRouteMapState extends State<OsmRouteMap> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 6))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final online = context.watch<AppState>().online;
    final depot = _depot(widget.depot);
    final pts = [depot, ...widget.stops.map((s) => LatLng(s.lat, s.lng))];
    final doneUntil = widget.stops.where((s) => s.done).length;
    final leg = widget.nextIndex.clamp(0, pts.length - 2);
    return SizedBox(
      height: widget.height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Stack(children: [
          FlutterMap(
            options: MapOptions(
              initialCameraFit: CameraFit.coordinates(coordinates: pts, padding: const EdgeInsets.all(36), maxZoom: 15),
              backgroundColor: k.surface2,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
            ),
            children: [
              _tintedTiles(context),
              PolylineLayer(polylines: [
                Polyline(points: pts, color: k.brand.withValues(alpha: 0.5), strokeWidth: 4, pattern: StrokePattern.dashed(segments: const [10, 8])),
                if (doneUntil > 0) Polyline(points: pts.sublist(0, doneUntil + 1), color: k.brand, strokeWidth: 5),
              ]),
              MarkerLayer(markers: [
                Marker(point: depot, width: 34, height: 34, child: const _DepotMarker()),
                for (final (i, s) in widget.stops.indexed)
                  Marker(point: LatLng(s.lat, s.lng), width: 34, height: 34, child: _StopMarker(n: i + 1, stop: s, current: i == widget.nextIndex)),
              ]),
              if (widget.moving && widget.nextIndex < widget.stops.length)
                AnimatedBuilder(
                  animation: _c,
                  builder: (context, _) {
                    final t = 0.15 + 0.7 * (0.5 - 0.5 * cos(_c.value * 2 * pi));
                    final a = pts[leg], b = pts[leg + 1];
                    final p = LatLng(a.latitude + (b.latitude - a.latitude) * t, a.longitude + (b.longitude - a.longitude) * t);
                    return MarkerLayer(markers: [Marker(point: p, width: 30, height: 30, child: const _Truck())]);
                  },
                ),
            ],
          ),
          _attribution(context),
          if (!online) _offlineChip(context),
        ]),
      ),
    );
  }
}

/// One store with its depot, for the stop screen — plus directions.
class OsmStopMap extends StatelessWidget {
  const OsmStopMap({super.key, required this.stop, this.depot, this.height = 190});
  final Stop stop;
  final String? depot;
  final double height;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final here = LatLng(stop.lat, stop.lng);
    final from = _depot(depot);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        height: height,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: Stack(children: [
            FlutterMap(
              options: MapOptions(
                initialCameraFit: CameraFit.coordinates(coordinates: [here, from], padding: const EdgeInsets.all(40), maxZoom: 15),
                backgroundColor: k.surface2,
                interactionOptions: const InteractionOptions(flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag),
              ),
              children: [
                _tintedTiles(context),
                PolylineLayer(polylines: [Polyline(points: [from, here], color: k.brand.withValues(alpha: 0.6), strokeWidth: 4, pattern: StrokePattern.dashed(segments: const [10, 8]))]),
                MarkerLayer(markers: [
                  Marker(point: from, width: 34, height: 34, child: const _DepotMarker()),
                  Marker(point: here, width: 40, height: 48, alignment: Alignment.topCenter, child: Icon(Icons.location_on_rounded, size: 46, color: k.brand, shadows: const [Shadow(color: Colors.black38, blurRadius: 6)])),
                ]),
              ],
            ),
            _attribution(context),
            if (!context.watch<AppState>().online) _offlineChip(context),
          ]),
        ),
      ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        onPressed: () => launchUrl(Uri.parse('https://www.openstreetmap.org/directions?route=%3B${stop.lat}%2C${stop.lng}#map=16/${stop.lat}/${stop.lng}'), mode: LaunchMode.externalApplication),
        icon: const Icon(Icons.navigation_rounded),
        label: const Text('Directions'),
      ),
    ]);
  }
}
