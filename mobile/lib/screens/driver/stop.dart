import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../state/app_state.dart';
import '../../theme.dart';
import '../../widgets/brand.dart';
import '../../widgets/common.dart';
import '../../widgets/osm_map.dart';

/// Arrive → record outcome → proof → done. Every step works offline.
class StopScreen extends StatefulWidget {
  const StopScreen({super.key, required this.tripId, required this.orderId});
  final String tripId, orderId;
  @override
  State<StopScreen> createState() => _StopScreenState();
}

class _StopScreenState extends State<StopScreen> {
  bool _delivering = false;
  String? _outcome;
  bool _itemsOk = false;
  final _receiver = TextEditingController();
  final _notes = TextEditingController();
  String? _photo, _signature;
  final Map<String, int> _partial = {};

  bool get _failed => _outcome == 'REFUSED' || _outcome == 'CLOSED' || _outcome == 'NO_ACCESS';

  Future<void> _takePhoto() async {
    final picker = ImagePicker();
    XFile? f;
    try {
      f = await picker.pickImage(source: ImageSource.camera, maxWidth: 900, imageQuality: 60);
    } catch (_) {
      f = await picker.pickImage(source: ImageSource.gallery, maxWidth: 900, imageQuality: 60);
    }
    if (f != null) setState(() => _photo = f!.path);
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AppState>();
    final k = context.k;
    final t = s.trip(widget.tripId);
    final st = t == null ? null : [...t.stops, ...t.reassigned].where((x) => x.orderId == widget.orderId).firstOrNull;
    if (t == null || st == null) return const Scaffold(body: Center(child: Text('Stop not found')));
    final idx = t.stops.indexOf(st);
    final next = t.stops.skip(idx + 1).where((x) => !x.done).firstOrNull;
    final reassigned = t.reassigned.contains(st);
    final canComplete = _outcome != null && (_failed || (_receiver.text.trim().isNotEmpty && _itemsOk && (_photo != null || _signature != null)));

    void complete() {
      final notes = [
        _notes.text.trim(),
        if (_outcome == 'PARTIAL') st.items.map((i) => '${i.name} ${_partial[i.name] ?? i.qty}/${i.qty}').join(', '),
      ].where((x) => x.isNotEmpty).join(' · ');
      s.record('DELIVER', t.id, orderId: st.orderId, data: {'outcome': _outcome, 'receiver': _receiver.text.trim(), 'notes': notes, 'offline': !s.online});
      if (_photo != null) s.record('PROOF_PHOTO', t.id, orderId: st.orderId, data: {'path': _photo});
      if (_signature != null) s.record('PROOF_SIGNATURE', t.id, orderId: st.orderId, data: {'png': _signature});
      setState(() => _delivering = false);
    }

    Widget body;
    if (st.done) {
      body = _Done(stop: st, next: next, onNext: next == null ? () => Navigator.pop(context) : () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => StopScreen(tripId: t.id, orderId: next.orderId))));
    } else if (st.status != StopStatus.arrived) {
      body = Column(key: const ValueKey('arrive'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KCard(
          child: Row(children: [
            _Info('ETA', hm(st.eta)),
            _Info('Window', '${hm(st.windowStart)}–${hm(st.windowEnd)}'),
            _Info('Items', '${st.units}'),
          ]),
        ),
        const SizedBox(height: 12),
        OsmStopMap(stop: st, depot: s.user?.depot),
        if (st.late) ...[const SizedBox(height: 12), _windowClosed(context, st)],
        const SizedBox(height: 20),
        _PulseButton(
          label: 'I’ve arrived',
          enabled: t.status == TripStatus.inProgress,
          onTap: () {
            s.record('ARRIVE', t.id, orderId: st.orderId);
            toast(context, s.online ? 'Arrival recorded · store notified' : 'Arrival saved on this device', icon: Icons.place_rounded);
          },
        ),
        if (t.status != TripStatus.inProgress) Padding(padding: const EdgeInsets.only(top: 10), child: Text(t.status == TripStatus.paused ? 'Route paused after a vehicle issue.' : 'Start your route first.', textAlign: TextAlign.center, style: context.text.bodySmall)),
      ]);
    } else if (!_delivering) {
      body = Column(key: const ValueKey('arrived'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KCard(
          child: Column(children: [
            Row(children: [_Info('Arrived', st.arrivedAt == null ? '—' : clock(st.arrivedAt!)), _Info('Window closes', hm(st.windowEnd))]),
            const Divider(height: 28),
            Row(children: [
              Text('Status', style: context.text.bodySmall),
              const Spacer(),
              st.late ? Tag('Late', color: k.attention) : Row(children: [Text('On time', style: TextStyle(color: k.success, fontWeight: FontWeight.w700)), Icon(Icons.check_rounded, color: k.success, size: 18)]),
            ]),
          ]),
        ).animate().fadeIn().scale(begin: const Offset(0.97, 0.97)),
        if (st.late) ...[const SizedBox(height: 12), _windowClosed(context, st)],
        const SizedBox(height: 20),
        FilledButton(onPressed: () => setState(() => _delivering = true), child: const Text('Begin delivery')),
      ]);
    } else {
      body = Column(key: const ValueKey('form'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Eyebrow('Delivery outcome'),
        const SizedBox(height: 8),
        ChoiceTiles<String>(
          value: _outcome,
          onChanged: (v) => setState(() => _outcome = v),
          options: [
            ('DELIVERED', 'Delivered in full', null),
            ('PARTIAL', 'Partial delivery', null),
            ('REFUSED', 'Refused', null),
            ('CLOSED', 'Outlet closed', 'Receiving team absent'),
            ('NO_ACCESS', 'Unable to access', st.mall ? 'Mall security / bay unavailable' : 'Access blocked'),
          ],
        ),
        if (_outcome != null && !_failed) ...[
          const SizedBox(height: 10),
          KCard(
            child: Column(children: [
              for (final i in st.items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(children: [
                    Expanded(child: Text(i.name, style: const TextStyle(fontWeight: FontWeight.w600))),
                    _outcome == 'PARTIAL'
                        ? Counter(value: _partial[i.name] ?? i.qty, max: i.qty, onChanged: (v) => setState(() => _partial[i.name] = v))
                        : Text('${i.qty} ${i.unit}', style: context.text.bodySmall),
                  ]),
                ),
              const SizedBox(height: 8),
              AnimatedSwitcher(
                duration: 250.ms,
                child: _itemsOk
                    ? Row(key: const ValueKey(1), mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.check_circle_rounded, color: k.success), const SizedBox(width: 6), const Text('Items confirmed', style: TextStyle(fontWeight: FontWeight.w700))])
                    : OutlinedButton(key: const ValueKey(0), onPressed: () => setState(() => _itemsOk = true), child: const Text('Confirm items')),
              ),
            ]),
          ),
        ],
        if (_outcome != null) ...[
          const SizedBox(height: 16),
          if (!_failed) TextField(controller: _receiver, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'Receiver name', prefixIcon: Icon(Icons.person_outline_rounded))),
          const SizedBox(height: 16),
          Eyebrow(_failed ? 'Photo of the outlet' : 'Proof photo'),
          const SizedBox(height: 8),
          Row(children: [
            AnimatedContainer(
              duration: 250.ms,
              width: 84,
              height: 84,
              decoration: BoxDecoration(color: k.surface2, borderRadius: BorderRadius.circular(16), border: Border.all(color: k.line, width: 1.5)),
              clipBehavior: Clip.antiAlias,
              child: _photo == null ? Icon(Icons.image_outlined, color: k.muted) : Image.file(File(_photo!), fit: BoxFit.cover).animate().fadeIn(),
            ),
            const SizedBox(width: 12),
            Expanded(child: OutlinedButton.icon(onPressed: _takePhoto, icon: const Icon(Icons.photo_camera_rounded), label: Text(_photo == null ? 'Take photo' : 'Retake'))),
          ]),
          if (!_failed) ...[
            const SizedBox(height: 16),
            const Eyebrow('Signature'),
            const SizedBox(height: 8),
            SignaturePad(onChanged: (v) => setState(() => _signature = v)),
          ],
          const SizedBox(height: 8),
          TextField(controller: _notes, maxLines: 2, decoration: const InputDecoration(labelText: 'Notes')),
          if (!_failed && _photo == null && _signature == null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('A photo or signature is required as proof of delivery.', style: context.text.bodySmall)),
        ],
        const SizedBox(height: 20),
        _failed
            ? FilledButton(style: FilledButton.styleFrom(backgroundColor: k.attention), onPressed: canComplete ? complete : null, child: const Text('Record failed attempt'))
            : AnimatedOpacity(
                duration: 200.ms,
                opacity: canComplete ? 1 : 0.45,
                child: IgnorePointer(ignoring: !canComplete, child: SlideToConfirm(label: 'Slide to complete delivery', onConfirmed: complete, icon: Icons.inventory_rounded)),
              ),
        if (!s.online) Padding(padding: const EdgeInsets.only(top: 10), child: Text('You’re offline — this is saved on the device and syncs automatically.', textAlign: TextAlign.center, style: context.text.bodySmall)),
      ]);
    }

    return Scaffold(
      appBar: AppBar(title: Text('Stop ${idx + 1} of ${t.stops.length}'), actions: const [Padding(padding: EdgeInsets.only(right: 12), child: NetPill())]),
      body: Column(children: [
        const ConnectivityBanner(),
        Expanded(
          child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 40), children: [
            Hero(
              tag: 'stop-${st.orderId}',
              child: Material(
                color: Colors.transparent,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Mono(st.outletId, size: 38),
                  Text('${st.outletName} · ${st.district}', style: context.text.bodyMedium?.copyWith(color: k.muted)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, children: [
                    if (st.chilled) Tag('Chilled', color: k.info, icon: Icons.ac_unit_rounded),
                    if (t.brand == 'Fresh') Tag('Fresh · before 08:00', color: k.attention, icon: Icons.schedule_rounded),
                    if (st.mall) Tag('Mall bay', color: k.info),
                    if (st.shortfall != null) Tag('${st.shortfall!.missing} × ${st.shortfall!.item} short', color: k.attention),
                    if (reassigned) Tag('Reassigned to another vehicle', color: k.attention),
                  ]),
                ]),
              ),
            ),
            const SizedBox(height: 18),
            AnimatedSwitcher(duration: 350.ms, switchInCurve: Curves.easeOutCubic, transitionBuilder: (c, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0.05, 0), end: Offset.zero).animate(a), child: c)), child: body),
          ]),
        ),
      ]),
    );
  }

  Widget _windowClosed(BuildContext context, Stop st) {
    final k = context.k;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: k.attentionSoft, borderRadius: BorderRadius.circular(16), border: Border.all(color: k.attention.withValues(alpha: 0.4))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Icon(Icons.warning_amber_rounded, color: k.attentionInk), const SizedBox(width: 8), Text('DELIVERY WINDOW CLOSED', style: TextStyle(fontWeight: FontWeight.w800, color: k.attentionInk))]),
        const SizedBox(height: 4),
        Text('Window ${hm(st.windowStart)}–${hm(st.windowEnd)}. Continue only if the outlet agrees to receive the delivery.'),
      ]),
    );
  }
}

class _Info extends StatelessWidget {
  const _Info(this.k, this.v);
  final String k, v;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: context.text.bodySmall),
          Text(v, style: const TextStyle(fontFamily: K.display, fontWeight: FontWeight.w700, fontSize: 20)),
        ]),
      );
}

class _PulseButton extends StatelessWidget {
  const _PulseButton({required this.label, required this.onTap, this.enabled = true});
  final String label;
  final VoidCallback onTap;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final btn = SizedBox(
      height: 72,
      child: FilledButton.icon(
        onPressed: enabled ? onTap : null,
        style: FilledButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)), textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        icon: const Icon(Icons.place_rounded, size: 26),
        label: Text(label),
      ),
    );
    if (!enabled) return btn;
    return Stack(alignment: Alignment.center, children: [
      Positioned.fill(
        child: DecoratedBox(decoration: BoxDecoration(borderRadius: BorderRadius.circular(22), color: k.brand.withValues(alpha: 0.35)))
            .animate(onPlay: (c) => c.repeat())
            .scaleXY(end: 1.08, duration: 1200.ms, curve: Curves.easeOut)
            .fadeOut(duration: 1200.ms),
      ),
      btn,
    ]);
  }
}

class _Done extends StatelessWidget {
  const _Done({required this.stop, required this.next, required this.onNext});
  final Stop stop;
  final Stop? next;
  final VoidCallback onNext;
  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final failed = stop.status == StopStatus.failed;
    return Column(key: const ValueKey('done'), children: [
      const SizedBox(height: 12),
      SuccessBurst(color: failed ? k.attention : k.success, size: 150),
      Text(failed ? 'Failed attempt recorded' : stop.status == StopStatus.partial ? 'Partial delivery recorded' : 'Delivered', style: context.text.headlineMedium).animate(delay: 400.ms).fadeIn().slideY(begin: 0.3),
      const SizedBox(height: 6),
      Text(
        [if (stop.completedAt != null) 'at ${clock(stop.completedAt!)}', if (stop.receiver?.isNotEmpty == true) 'received by ${stop.receiver}'].join(' · '),
        style: context.text.bodySmall,
      ).animate(delay: 500.ms).fadeIn(),
      const SizedBox(height: 10),
      if (stop.offline) Tag('Recorded offline · syncs automatically', color: k.muted, icon: Icons.cloud_off_rounded).animate(delay: 600.ms).fadeIn(),
      if (stop.signature != null || stop.photoPath != null)
        Padding(padding: const EdgeInsets.only(top: 8), child: Tag('Proof attached', color: k.success, icon: Icons.verified_rounded)).animate(delay: 700.ms).fadeIn(),
      const SizedBox(height: 28),
      FilledButton.icon(onPressed: onNext, icon: Icon(next == null ? Icons.flag_rounded : Icons.arrow_forward_rounded), label: Text(next == null ? 'Finish route' : 'Next stop · ${next!.outletId}')).animate(delay: 800.ms).fadeIn().slideY(begin: 0.3),
    ]);
  }
}
