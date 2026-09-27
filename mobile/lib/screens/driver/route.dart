import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../state/app_state.dart';
import '../../theme.dart';
import '../../widgets/osm_map.dart';
import '../../widgets/common.dart';
import 'stop.dart';
import 'today.dart';

class DriverRoute extends StatelessWidget {
  const DriverRoute({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AppState>();
    final t = s.myTrip;
    final k = context.k;
    if (t == null) return const EmptyState(icon: Icons.route_rounded, title: 'No route yet', body: 'Your stops appear here once your trip is planned.');
    final next = t.nextStop;
    final nextIdx = next == null ? t.stops.length : t.stops.indexOf(next);

    void open(Stop st) => Navigator.of(context).push(PageRouteBuilder(
          transitionDuration: 380.ms,
          pageBuilder: (_, a, _) => FadeTransition(opacity: a, child: StopScreen(tripId: t.id, orderId: st.orderId)),
        ));

    final list = [
      Row(children: [
        _ProgressRing(done: t.doneCount, total: t.stops.length),
        const SizedBox(width: 18),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${t.doneCount} / ${t.stops.length} complete', style: context.text.titleLarge),
            Text('${t.vehicleId} · Trip ${t.number} · ${t.district}', style: context.text.bodySmall),
            if (t.status == TripStatus.paused) Padding(padding: const EdgeInsets.only(top: 6), child: Tag('Route paused', color: k.critical, icon: Icons.pause_circle_rounded)),
          ]),
        ),
      ]).animate().fadeIn(),
      const SizedBox(height: 18),
      if (next != null && t.status == TripStatus.inProgress)
        Hero(
          tag: 'stop-${next.orderId}',
          child: Material(
            color: Colors.transparent,
            child: KCard(
              onTap: () => open(next),
              padding: EdgeInsets.zero,
              border: k.brand.withValues(alpha: 0.5),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                  decoration: BoxDecoration(color: k.brandSoft, borderRadius: const BorderRadius.vertical(top: Radius.circular(20))),
                  child: Eyebrow('Next stop', color: k.brandInk),
                ),
                Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Mono(next.outletId, size: 30),
                    Text(next.outletName, style: context.text.bodyMedium?.copyWith(color: k.muted)),
                    const SizedBox(height: 14),
                    Row(children: [
                      _KV('ETA', hm(next.eta), big: true),
                      _KV('Window', '${hm(next.windowStart)}–${hm(next.windowEnd)}'),
                      _KV('Service', '${next.serviceMin} min'),
                    ]),
                    if (next.late) ...[
                      const SizedBox(height: 12),
                      _Warn(color: k.attention, icon: Icons.schedule_rounded, text: 'Delivery window will be missed — continue only if the outlet agrees.'),
                    ],
                    if (next.mall) ...[
                      const SizedBox(height: 12),
                      _Warn(color: k.info, icon: Icons.local_mall_outlined, text: 'Mall access window ${hm(next.windowStart)}–${hm(next.windowEnd)}. Security admits deliveries only inside it.'),
                    ],
                    const SizedBox(height: 16),
                    FilledButton.icon(onPressed: () => open(next), icon: Icon(next.status == StopStatus.arrived ? Icons.inventory_rounded : Icons.near_me_rounded), label: Text(next.status == StopStatus.arrived ? 'Deliver' : 'Open stop')),
                  ]),
                ),
              ]),
            ),
          ),
        ).animate().fadeIn(delay: 80.ms).slideY(begin: 0.05),
      const SizedBox(height: 18),
      for (final (i, st) in t.stops.indexed) _StopRow(stop: st, index: i, current: i == nextIdx, last: i == t.stops.length - 1, onTap: () => open(st)).animate(delay: (60 * i).ms).fadeIn().slideX(begin: 0.04),
      if (t.reassigned.isNotEmpty) ...[
        const SizedBox(height: 8),
        for (final st in t.reassigned)
          Padding(
            padding: const EdgeInsets.only(left: 46, bottom: 6),
            child: Row(children: [Mono(st.outletId, size: 13, color: k.muted), const SizedBox(width: 8), Tag('Reassigned', color: k.attention)]),
          ),
      ],
    ];

    return LayoutBuilder(builder: (context, c) {
      final map = OsmRouteMap(stops: t.stops, nextIndex: nextIdx, depot: s.user?.depot, height: c.maxWidth > 700 ? 460 : 260, moving: t.status == TripStatus.inProgress);
      if (c.maxWidth > 700) {
        // Tablet / landscape: list and map side by side.
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 12, 32), children: list)),
          Expanded(child: Padding(padding: const EdgeInsets.fromLTRB(12, 4, 20, 20), child: map)),
        ]);
      }
      return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [...list, const SizedBox(height: 12), map]);
    });
  }
}

class _KV extends StatelessWidget {
  const _KV(this.k, this.v, {this.big = false});
  final String k, v;
  final bool big;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: context.text.bodySmall),
          Text(v, style: TextStyle(fontFamily: K.display, fontWeight: FontWeight.w700, fontSize: big ? 24 : 16)),
        ]),
      );
}

class _Warn extends StatelessWidget {
  const _Warn({required this.color, required this.icon, required this.text});
  final Color color;
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [Icon(icon, color: color, size: 20), const SizedBox(width: 10), Expanded(child: Text(text, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)))]),
      );
}

class _StopRow extends StatelessWidget {
  const _StopRow({required this.stop, required this.index, required this.current, required this.last, required this.onTap});
  final Stop stop;
  final int index;
  final bool current, last;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final done = stop.done;
    final color = done ? (stop.status == StopStatus.failed ? k.attention : k.success) : current ? k.info : k.line;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(
            width: 34,
            child: Column(children: [
              AnimatedContainer(
                duration: 300.ms,
                width: 30,
                height: 30,
                decoration: BoxDecoration(shape: BoxShape.circle, color: done ? color : Colors.transparent, border: Border.all(color: color, width: 2.5)),
                child: Center(
                  child: done
                      ? Icon(stop.status == StopStatus.failed ? Icons.priority_high_rounded : Icons.check_rounded, size: 17, color: Colors.white)
                      : Text('${index + 1}', style: TextStyle(fontWeight: FontWeight.w700, color: current ? k.info : k.muted)),
                ),
              ),
              if (!last) Expanded(child: Container(width: 2.5, margin: const EdgeInsets.symmetric(vertical: 3), color: done ? k.success.withValues(alpha: 0.5) : k.line)),
            ]),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 18, top: 2),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Mono(stop.outletId),
                      if (stop.chilled) Padding(padding: const EdgeInsets.only(left: 6), child: Icon(Icons.ac_unit_rounded, size: 14, color: k.info)),
                      if (stop.offline && done) Padding(padding: const EdgeInsets.only(left: 6), child: Icon(Icons.cloud_off_rounded, size: 14, color: k.muted)),
                    ]),
                    Text(stop.outletName, style: context.text.bodySmall),
                  ]),
                ),
                done ? Tag(stopStatusLabel(stop), color: color) : Text(hm(stop.eta), style: TextStyle(fontFamily: K.mono, fontWeight: FontWeight.w700, color: k.muted)),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

class _ProgressRing extends StatelessWidget {
  const _ProgressRing({required this.done, required this.total});
  final int done, total;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return TweenAnimationBuilder<double>(
      tween: Tween(end: total == 0 ? 0 : done / total),
      duration: 900.ms,
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => SizedBox(
        width: 76,
        height: 76,
        child: CustomPaint(
          painter: _Ring(v, k.brand, k.line),
          child: Center(child: Text('${(v * 100).round()}%', style: const TextStyle(fontFamily: K.display, fontWeight: FontWeight.w700, fontSize: 18))),
        ),
      ),
    );
  }
}

class _Ring extends CustomPainter {
  _Ring(this.v, this.color, this.track);
  final double v;
  final Color color, track;
  @override
  void paint(Canvas canvas, Size size) {
    final r = Rect.fromLTWH(5, 5, size.width - 10, size.height - 10);
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(r, 0, 2 * pi, false, p..color = track);
    canvas.drawArc(r, -pi / 2, 2 * pi * v, false, p..color = color);
  }

  @override
  bool shouldRepaint(_Ring old) => old.v != v;
}
