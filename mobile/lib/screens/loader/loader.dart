import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../state/app_state.dart';
import '../../theme.dart';
import '../../widgets/brand.dart';
import '../../widgets/common.dart';
import '../../widgets/osm_map.dart';

String tripLabel(TripStatus s) => switch (s) {
      TripStatus.planned => 'Ready to load',
      TripStatus.loading => 'Loading',
      TripStatus.loaded => 'Loaded',
      TripStatus.inProgress => 'On route',
      TripStatus.paused => 'Paused',
      TripStatus.completed => 'Completed',
    };

Color tripColor(BuildContext context, TripStatus s) => switch (s) {
      TripStatus.planned => context.k.brand,
      TripStatus.loading => context.k.attention,
      TripStatus.loaded || TripStatus.inProgress => context.k.info,
      TripStatus.paused => context.k.critical,
      TripStatus.completed => context.k.success,
    };

class LoaderToday extends StatelessWidget {
  const LoaderToday({super.key, required this.onOpenTrips});
  final VoidCallback onOpenTrips;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AppState>();
    final k = context.k;
    final ready = s.trips.where((t) => t.status == TripStatus.planned).length;
    final loading = s.trips.where((t) => t.status == TripStatus.loading).length;
    final done = s.trips.length - ready - loading;
    final next = s.trips.where((t) => t.status == TripStatus.planned || t.status == TripStatus.loading).toList()..sort((a, b) => a.departure.compareTo(b.departure));
    return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [
      Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [K.teal, Color(0xFF0C4F50), K.ink]),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${s.user!.depot.toUpperCase()} LOADING BAY', style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 11, letterSpacing: 1.6, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('${s.trips.length} trips today', style: const TextStyle(fontFamily: K.display, fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white)),
          const SizedBox(height: 18),
          Row(children: [
            _Big(value: ready, label: 'Ready', color: K.tealLight),
            _Big(value: loading, label: 'Loading', color: const Color(0xFFF2A275)),
            _Big(value: done, label: 'Completed', color: const Color(0xFF7BDAA8)),
          ]),
        ]),
      ).animate().fadeIn().slideY(begin: 0.05),
      const SizedBox(height: 20),
      Row(children: [Text('Up next', style: context.text.titleLarge), const Spacer(), TextButton(onPressed: onOpenTrips, child: const Text('All trips'))]),
      const SizedBox(height: 8),
      if (next.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text('All trips are loaded. Nice work.', textAlign: TextAlign.center, style: TextStyle(color: k.muted))),
      for (final (i, t) in next.indexed) Padding(padding: const EdgeInsets.only(bottom: 10), child: TripTile(trip: t).animate(delay: (80 * i).ms).fadeIn().slideX(begin: 0.05)),
    ]);
  }
}

class _Big extends StatelessWidget {
  const _Big({required this.value, required this.label, required this.color});
  final int value;
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          TweenAnimationBuilder<int>(
            tween: IntTween(begin: 0, end: value),
            duration: 800.ms,
            builder: (_, v, _) => Text('$v', style: TextStyle(fontFamily: K.display, fontSize: 34, fontWeight: FontWeight.w700, color: color)),
          ),
          Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.65), fontSize: 13)),
        ]),
      );
}

class TripTile extends StatelessWidget {
  const TripTile({super.key, required this.trip});
  final Trip trip;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final c = tripColor(context, trip.status);
    return KCard(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LoadScreen(tripId: trip.id))),
      child: Row(children: [
        Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(color: c.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(16)),
          child: Icon(trip.reefer ? Icons.ac_unit_rounded : Icons.local_shipping_rounded, color: c),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Mono(trip.vehicleId, size: 18),
            Text('Trip ${trip.number} · ${trip.brand} · ${trip.district} · ${trip.stops.length} stops', style: context.text.bodySmall),
            const SizedBox(height: 6),
            Tag(tripLabel(trip.status), color: c),
          ]),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(hm(trip.departure), style: const TextStyle(fontFamily: K.display, fontSize: 22, fontWeight: FontWeight.w700)),
          Text('departure', style: context.text.bodySmall),
        ]),
        Icon(Icons.chevron_right_rounded, color: k.muted),
      ]),
    );
  }
}

class LoaderTrips extends StatefulWidget {
  const LoaderTrips({super.key});
  @override
  State<LoaderTrips> createState() => _LoaderTripsState();
}

class _LoaderTripsState extends State<LoaderTrips> {
  bool _todo = true;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AppState>();
    final list = s.trips.where((t) => _todo ? (t.status == TripStatus.planned || t.status == TripStatus.loading) : !(t.status == TripStatus.planned || t.status == TripStatus.loading)).toList()
      ..sort((a, b) => a.departure.compareTo(b.departure));
    return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [
      SegmentedButton<bool>(
        segments: const [ButtonSegment(value: true, label: Text('To load')), ButtonSegment(value: false, label: Text('Loaded'))],
        selected: {_todo},
        onSelectionChanged: (v) => setState(() => _todo = v.first),
      ),
      const SizedBox(height: 14),
      if (list.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Text(_todo ? 'Nothing left to load.' : 'No loaded trips yet.', textAlign: TextAlign.center)),
      for (final (i, t) in list.indexed) Padding(padding: const EdgeInsets.only(bottom: 10), child: TripTile(trip: t).animate(delay: (60 * i).ms).fadeIn().slideY(begin: 0.1)),
    ]);
  }
}

/// Load in reverse stop order so the first delivery comes off first.
class LoadScreen extends StatefulWidget {
  const LoadScreen({super.key, required this.tripId});
  final String tripId;
  @override
  State<LoadScreen> createState() => _LoadScreenState();
}

class _LoadScreenState extends State<LoadScreen> {
  String? _open;

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AppState>();
    final k = context.k;
    final t = s.trip(widget.tripId);
    if (t == null) return const Scaffold(body: Center(child: Text('Trip not found')));
    final order = t.stops.reversed.toList();
    final current = _open ?? order.where((x) => !x.loadConfirmed).firstOrNull?.orderId ?? order.first.orderId;
    final confirmed = t.stops.where((x) => x.loadConfirmed).length;
    final started = t.status != TripStatus.planned;
    final canComplete = confirmed == t.stops.length && t.status == TripStatus.loading;

    final sequence = KCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        _Band('LOAD FIRST', k.brandSoft, k.brandInk, top: true),
        for (final st in order)
          InkWell(
            onTap: () => setState(() => _open = st.orderId),
            child: AnimatedContainer(
              duration: 200.ms,
              color: st.orderId == current ? k.surface2 : Colors.transparent,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(children: [
                AnimatedContainer(
                  duration: 300.ms,
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: st.loadConfirmed ? k.success : st.orderId == current ? k.brand : k.surface2, borderRadius: BorderRadius.circular(12)),
                  child: Center(
                    child: st.loadConfirmed
                        ? const Icon(Icons.check_rounded, color: Colors.white).animate().scale(curve: Curves.elasticOut, duration: 500.ms)
                        : Text('${t.stops.indexOf(st) + 1}', style: TextStyle(fontFamily: K.display, fontSize: 20, fontWeight: FontWeight.w700, color: st.orderId == current ? Colors.white : k.ink)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Mono(st.outletId), Text(st.outletName, style: context.text.bodySmall)])),
                if (st.shortfall != null) Tag('Short', color: k.attention),
                if (st.chilled) Padding(padding: const EdgeInsets.only(left: 6), child: Icon(Icons.ac_unit_rounded, size: 18, color: k.info)),
              ]),
            ),
          ),
        _Band('UNLOAD FIRST · STOP 1', k.surface2, k.muted),
      ]),
    );

    final detail = !started
        ? KCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const _CrateStack(filled: 0),
              const SizedBox(height: 12),
              Text('Ready to load', style: context.text.titleLarge, textAlign: TextAlign.center),
              Text('Load in reverse stop order so the first delivery comes off first.', textAlign: TextAlign.center, style: context.text.bodySmall),
              const SizedBox(height: 16),
              SlideToConfirm(label: 'Slide to start loading', onConfirmed: () => s.record('LOAD_START', t.id)),
            ]),
          )
        : Column(children: [
            _CrateStack(filled: confirmed, total: t.stops.length),
            const SizedBox(height: 12),
            _StopLoader(key: ValueKey(current), trip: t, stop: t.stops.firstWhere((x) => x.orderId == current), onConfirmed: () => setState(() => _open = null)),
          ]);

    final complete = t.status == TripStatus.loaded || t.status == TripStatus.inProgress || t.status == TripStatus.completed
        ? Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: k.successSoft, borderRadius: BorderRadius.circular(18)),
            child: Row(children: [Icon(Icons.verified_rounded, color: k.success), const SizedBox(width: 10), const Expanded(child: Text('Loading complete · driver notified', style: TextStyle(fontWeight: FontWeight.w700)))]),
          )
        : AnimatedOpacity(
            duration: 200.ms,
            opacity: canComplete ? 1 : 0.45,
            child: IgnorePointer(
              ignoring: !canComplete,
              child: SlideToConfirm(
                label: canComplete ? 'Slide to complete loading' : 'Confirm all stops ($confirmed/${t.stops.length})',
                color: k.success,
                icon: Icons.inventory_rounded,
                onConfirmed: () {
                  s.record('LOAD_COMPLETE', t.id);
                  toast(context, s.online ? '${t.vehicleId} loaded · driver notified' : 'Saved offline — will sync');
                },
              ),
            ),
          );

    final roadMap = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Eyebrow('On the road · stop 1 comes off first'),
      const SizedBox(height: 8),
      OsmRouteMap(stops: t.stops, nextIndex: t.stops.length, depot: s.user?.depot, height: 240, moving: false),
    ]);

    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Mono(t.vehicleId, size: 20),
          Text('Trip ${t.number} · ${t.brand} · departs ${hm(t.departure)}', style: context.text.bodySmall),
        ]),
        actions: const [Padding(padding: EdgeInsets.only(right: 12), child: NetPill())],
      ),
      body: Column(children: [
        const ConnectivityBanner(),
        Expanded(
          child: LayoutBuilder(builder: (context, c) {
            if (c.maxWidth > 720) {
              // Tablet at the bay: sequence on the left, the stop being loaded on the right.
              return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: c.maxWidth * 0.42, child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 10, 24), children: [sequence])),
                Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(10, 8, 20, 24), children: [detail, const SizedBox(height: 16), complete, const SizedBox(height: 16), roadMap])),
              ]);
            }
            return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [detail, const SizedBox(height: 16), sequence, const SizedBox(height: 16), complete, const SizedBox(height: 16), roadMap]);
          }),
        ),
      ]),
    );
  }
}

class _Band extends StatelessWidget {
  const _Band(this.text, this.bg, this.fg, {this.top = false});
  final String text;
  final Color bg, fg;
  final bool top;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(color: bg, borderRadius: top ? const BorderRadius.vertical(top: Radius.circular(20)) : const BorderRadius.vertical(bottom: Radius.circular(20))),
        child: Row(children: [
          Icon(top ? Icons.south_rounded : Icons.north_rounded, size: 14, color: fg),
          const SizedBox(width: 6),
          Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.4, color: fg)),
        ]),
      );
}

/// A little truck box that fills with crates as stops are confirmed.
class _CrateStack extends StatelessWidget {
  const _CrateStack({required this.filled, this.total = 5});
  final int filled, total;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Container(
      height: 110,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: K.ink, borderRadius: BorderRadius.circular(20)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        for (var i = 0; i < total; i++)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: i < filled
                  ? Container(
                      height: 60 + (i % 2) * 14,
                      decoration: BoxDecoration(color: i == filled - 1 ? K.chocolate : K.teal, borderRadius: BorderRadius.circular(8)),
                      child: Center(child: Text('${total - i}', style: const TextStyle(color: Colors.white, fontFamily: K.mono, fontWeight: FontWeight.w700, fontSize: 18))),
                    ).animate().moveY(begin: -60, duration: 450.ms, curve: Curves.bounceOut).fadeIn()
                  : Container(height: 60, decoration: BoxDecoration(border: Border.all(color: Colors.white12, width: 1.5), borderRadius: BorderRadius.circular(8))),
            ),
          ),
        const SizedBox(width: 8),
        Container(width: 26, decoration: BoxDecoration(color: k.brand, borderRadius: BorderRadius.circular(8)), child: const Icon(Icons.local_shipping_rounded, color: Colors.white, size: 18)),
      ]),
    );
  }
}

class _StopLoader extends StatefulWidget {
  const _StopLoader({super.key, required this.trip, required this.stop, required this.onConfirmed});
  final Trip trip;
  final Stop stop;
  final VoidCallback onConfirmed;
  @override
  State<_StopLoader> createState() => _StopLoaderState();
}

class _StopLoaderState extends State<_StopLoader> {
  late final Map<String, int> _counts = {for (final i in widget.stop.items) i.name: widget.stop.loaded[i.name] ?? 0};

  @override
  Widget build(BuildContext context) {
    final s = context.read<AppState>();
    final k = context.k;
    final st = widget.stop;
    final unresolved = st.items.where((i) => _counts[i.name]! < i.qty && st.shortfall?.item != i.name).toList();
    return KCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Eyebrow('Stop ${widget.trip.stops.indexOf(st) + 1}'),
            Mono(st.outletId, size: 26),
            Text(st.outletName, style: context.text.bodySmall),
          ]),
          const Spacer(),
          if (st.chilled) Tag('Chilled', color: k.info, icon: Icons.ac_unit_rounded),
        ]),
        const Divider(height: 28),
        for (final i in st.items) ...[
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(i.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                Text('${_counts[i.name]} / ${i.qty} ${i.unit}', style: TextStyle(color: _counts[i.name]! >= i.qty ? k.success : k.muted, fontWeight: FontWeight.w600)),
              ]),
            ),
            Counter(value: _counts[i.name]!, max: i.qty, onChanged: (v) => setState(() => _counts[i.name] = v)),
            const SizedBox(width: 8),
            SizedBox(
              width: 58,
              height: 48,
              child: FilledButton(
                style: FilledButton.styleFrom(minimumSize: Size.zero, padding: EdgeInsets.zero),
                onPressed: _counts[i.name]! >= i.qty ? null : () => setState(() => _counts[i.name] = i.qty),
                child: const Text('All', style: TextStyle(fontSize: 14)),
              ),
            ),
          ]),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: _counts[i.name]! / i.qty),
              duration: 300.ms,
              builder: (_, v, _) => LinearProgressIndicator(value: v, minHeight: 6, backgroundColor: k.surface2, color: v >= 1 ? k.success : k.brand),
            ),
          ),
          if (_counts[i.name]! < i.qty && _counts[i.name]! > 0 && st.shortfall?.item != i.name)
            TextButton.icon(
              style: TextButton.styleFrom(foregroundColor: k.attentionInk, padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
              onPressed: () => showShortfallSheet(context, widget.trip, st, i, _counts[i.name]!),
              icon: const Icon(Icons.warning_amber_rounded, size: 18),
              label: Text('${i.qty - _counts[i.name]!} missing — report shortfall'),
            ),
          if (st.shortfall?.item == i.name) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Shortfall reported · dispatcher notified', style: TextStyle(color: k.attentionInk, fontWeight: FontWeight.w600))),
          const SizedBox(height: 14),
        ],
        unresolved.isNotEmpty
            ? Text('Count every item, or report a shortfall, to confirm this stop.', style: context.text.bodySmall, textAlign: TextAlign.center)
            : FilledButton.icon(
                onPressed: () {
                  s.record('LOAD_COUNT', widget.trip.id, orderId: st.orderId, data: {'counts': _counts});
                  toast(context, '${st.outletId} confirmed');
                  widget.onConfirmed();
                },
                icon: const Icon(Icons.check_rounded),
                label: Text(st.loadConfirmed ? 'Update counts' : 'Confirm ${st.outletId}'),
              ),
      ]),
    );
  }
}

void showShortfallSheet(BuildContext context, Trip t, Stop st, Item item, int available) {
  String? reason;
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      final k = ctx.k;
      final s = ctx.read<AppState>();
      return SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Eyebrow(st.outletId, color: k.attentionInk),
            Text('Loading shortfall', style: ctx.text.headlineMedium),
            const SizedBox(height: 14),
            Row(children: [
              for (final (l, v, hi) in [('Expected', item.qty, false), ('Available', available, false), ('Shortfall', item.qty - available, true)])
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: hi ? k.attentionSoft : k.surface2, borderRadius: BorderRadius.circular(14)),
                    child: Column(children: [Text(l, style: ctx.text.bodySmall), Text('$v', style: TextStyle(fontFamily: K.display, fontSize: 26, fontWeight: FontWeight.w700, color: hi ? k.attentionInk : k.ink))]),
                  ),
                ),
            ]),
            Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(item.name, textAlign: TextAlign.center, style: ctx.text.bodySmall)),
            ChoiceTiles<String>(
              value: reason,
              onChanged: (v) => set(() => reason = v),
              options: const [('Inventory unavailable', 'Inventory unavailable', null), ('Damaged item', 'Damaged item', null), ('Wrong item', 'Wrong item', null), ('Missing stock', 'Missing stock', null), ('Other', 'Other', null)],
            ),
            const SizedBox(height: 8),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: k.attention),
              onPressed: reason == null
                  ? null
                  : () {
                      s.record('SHORTFALL', t.id, orderId: st.orderId, data: {'item': item.name, 'missing': item.qty - available, 'reason': reason});
                      Navigator.pop(ctx);
                      toast(context, s.online ? 'Dispatcher notified' : 'Saved offline', icon: Icons.warning_amber_rounded);
                    },
              child: Text(s.online ? 'Notify dispatcher' : 'Save offline'),
            ),
          ]),
        ),
      );
    }),
  );
}

class LoaderIssues extends StatelessWidget {
  const LoaderIssues({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AppState>();
    final k = context.k;
    final shorts = [for (final t in s.trips) for (final st in t.stops) if (st.shortfall != null) (t, st)];
    if (shorts.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.inventory_2_outlined, size: 48, color: k.muted).animate(onPlay: (c) => c.repeat(reverse: true)).moveY(end: -6, duration: 1.seconds),
          const SizedBox(height: 12),
          Text('No shortfalls reported', style: context.text.titleLarge),
          Text('Report one from any stop while loading.', style: context.text.bodySmall),
        ]),
      );
    }
    return ListView(padding: const EdgeInsets.all(16), children: [
      for (final (t, st) in shorts)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: KCard(
            border: k.attention.withValues(alpha: 0.4),
            child: Row(children: [
              Icon(Icons.warning_amber_rounded, color: k.attention),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Mono('${st.outletId} · ${t.vehicleId}'),
                  Text('${st.shortfall!.missing} × ${st.shortfall!.item} · ${st.shortfall!.reason}', style: context.text.bodySmall),
                ]),
              ),
              Tag('With dispatcher', color: K.warning),
            ]),
          ),
        ),
    ]);
  }
}
