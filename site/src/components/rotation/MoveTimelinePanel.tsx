// A row's Time panel: the move's own frames as a mini timeline (field, stance, time stop, motion stop)
// with flags for its timing points, and a ruler in rotation time.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { TooltipManager, getCharacterThemeColor, tip, tooltipLine } from '../../utils/Common';
import { GAME_DEFAULTS } from '../../data/db';
import { TWO_MIN, timingLabel } from '../../logic/rotationRows';
import { sortedPrioritySteps } from '../../logic/engineValues';
import { sortedStanceChanges } from '../../utils/Stance';
import { formatFramesAsClock, formatFramesAsSeconds, frozenFramesWithin, hitFrameOffsets, toFrames } from '../../utils/Frames';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';
import { resolveDefaultNum } from '../builder/mechanicNodeHelpers';
import { PanelInfoItem } from '../common/PanelInfoItem';
import { SplitValue } from '../common/SplitValue';
import { SegmentedToggle } from '../common/SegmentedToggle';
import { bindingsOf, describeBinding } from '../../logic/inputBindings';
import { INPUT_KEY_MAP } from '../../data/db';
import { TimelineRuler } from '../timeline/TimelineRuler';
import { rowHits, stackDots } from '../timeline/timelineLayout';
import type { Tick } from '../timeline/timelineLayout';
import { nearestMarker, trackPointer, useActiveMarker, useFrameMove } from '../timeline/trackPointer';
import type { MechanicNode } from '../../types';

interface MoveTimelinePanelProps {
  row: any;
  onInputChoice?: (choice: number | undefined) => void;
}

// `label` is shown on the bar with its duration ('' for the duration alone).
interface Segment { from: number; to: number; className: string; label?: string; html: string }
interface Flag { at: number; label: string; html: string; tone?: 'cut' | 'warn' }

const DSL_CTX = { default: GAME_DEFAULTS };
const keyLabel = (input: string) => INPUT_KEY_MAP[input] || input;
const AUTO_INPUT = -1;
const secs = (frames: number) => formatFramesAsSeconds(toFrames(frames));
const framesAndSecs = (frames: number) => `${Math.round(frames)}f (${secs(frames)})`;
// Ruler steps (frames), smallest that keeps ~8 labels.
const TICK_STEPS = [6, 10, 15, 30, 60, 120, 300];
const LANE_LABEL_REM = 6.5;
const FLAG_CHAR_REM = 0.36;
const FLAG_PAD_REM = 0.6;
const FLAG_GAP_PX = 4;
const FLAG_LANE_REM = 1.375;
// Sync with .move-timeline-lane / .move-timeline-seg.
const LANE_REM = 1.5;
const SEG_INSET_REM = 0.25;

const html = (title: string, ...lines: Array<[string, unknown] | false | undefined>) =>
  `<div class="tooltip-title">${title}</div>` + lines.filter((l): l is [string, unknown] => !!l).map(([k, v]) => tooltipLine(k, v)).join('');

// Track width in px, for laying out flags.
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The Time sub panel: start/end in the TIME column's direction, then the move's mini timeline. */
export const MoveTimelinePanel: React.FC<MoveTimelinePanelProps> = ({ row, onInputChoice }) => {
  const countdown = useTimelineViewStore(s => s.timeCountdown);
  const [trackRef, trackWidth] = useWidth();
  const move: MechanicNode | undefined = DataLoader.mechanicsDB[row.action];
  const bindings = bindingsOf(move);
  const num = (v: unknown) => resolveDefaultNum(v as any, DSL_CTX) ?? undefined;
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  const base = row.baseDuration || 0;
  const cut = row.duration || 0;
  const anim = Math.max(row.animationCommitment || 0, cut);
  const freezeStart = row.freezeStart || 0;
  const freeze = row.freezeTime || 0;
  const motionStop = row.motionStop || 0;
  const gameStart = row.gameTimeStart || 0;
  const gameEnd = gameStart + (row.gameTimePassed || 0);
  const realStart = row.timeStart || 0;

  const hitCount = move?.hitMults?.length || 0;
  const tf = row.damageTimeframe || { start: 0, end: 0 };
  const hitOffsets = hitFrameOffsets(hitCount, tf.start, tf.end, row.hitFrameOverrides || []);
  const allowedHits = Math.min(hitCount, row.allowedHits ?? hitCount);

  const span = Math.max(1, base, anim, freezeStart + freeze, motionStop, ...hitOffsets);
  const pct = (frames: number) => (Math.max(0, Math.min(span, frames)) / span) * 100;
  // Rotation game time at a frame of the move: it stands still through the move's own time stop.
  const gameAt = (frames: number) => gameStart + frames - frozenFramesWithin(Math.min(frames, cut), freezeStart, freeze);
  const clock = (frames: number) => formatFramesAsClock(toFrames(countdown ? TWO_MIN - frames : frames));
  // Real time is a recording's clock: always counts up.
  const realClock = (frames: number) => formatFramesAsClock(toFrames(frames));
  // Back from rotation game time to a frame of the move (past its window, so after the time stop).
  const localAt = (game: number) => game - gameStart + frozenFramesWithin(cut, freezeStart, freeze);

  const themeColor = getCharacterThemeColor(DataLoader.characterDB[row.unit]);
  const swappedOut = anim > cut;
  const backAt = row.backOnFieldAt !== undefined ? Math.min(anim, Math.max(cut, localAt(row.backOnFieldAt))) : undefined;

  // --- Field lane ---
  const field: Segment[] = [{
    from: 0, to: cut, className: 'timeline-clip timeline-clip-onfield', label: 'On',
    html: html('On Field', ['Frames', `0 – ${framesAndSecs(cut)}`], ['Timing', timingLabel(row)])
  }];
  if (swappedOut) {
    const offEnd = backAt ?? anim;
    field.push({
      from: cut, to: offEnd, className: 'timeline-clip timeline-clip-offfield', label: 'Off',
      html: html('Off Field', ['Frames', `${Math.round(cut)} – ${framesAndSecs(offEnd)}`], ['Note', 'The animation plays out after the swap'])
    });
    if (backAt !== undefined && backAt < anim) {
      field.push({
        from: backAt, to: anim, className: 'timeline-clip timeline-clip-onfield', label: 'Back',
        html: html('Back On Field', ['Frames', `${Math.round(backAt)} – ${framesAndSecs(anim)}`], ['Note', 'Swapped back in before it finished'])
      });
    }
  } else if (base > cut) {
    field.push({
      from: cut, to: base, className: 'move-timeline-cut', label: 'Cut',
      html: html('Not Played', ['Frames', `${Math.round(cut)} – ${framesAndSecs(base)}`], ['Note', 'Cut by the next move'])
    });
  }
  // Another unit's motion stop: the segments split around it, each piece keeping its label.
  const pauses: Segment[] = (row.motionStopPauses || []).map((p: any) => {
    const from = localAt(p.gameTime);
    return {
      from, to: from + p.frames, className: 'timeline-clip timeline-clip-motionstop', label: 'Paused',
      html: html('Paused', ['By', `${p.by} (${p.moveName})`], ['Length', framesAndSecs(p.frames)])
    };
  });
  const fieldLane: Segment[] = [
    ...field.flatMap(seg => pauses.reduce<Segment[]>((pieces, pause) => pieces.flatMap(piece => {
      if (pause.to <= piece.from || pause.from >= piece.to) return [piece];
      return [{ ...piece, to: pause.from }, { ...piece, from: pause.to }].filter(p => p.to > p.from);
    }), [seg])),
    ...pauses
  ].sort((a, b) => a.from - b.from);

  // --- Stance lane: as the builder draws it (the move's requirement, then its changes) ---
  const changes = move ? sortedStanceChanges(move) : [];
  const stance: Segment[] = [];
  let stanceFrom = 0;
  let current = move?.stanceReq || 'Any';
  const pushStance = (to: number) => {
    if (to <= stanceFrom) return;
    stance.push({
      from: stanceFrom, to, className: `mech-stance-seg is-${current.toLowerCase()}`, label: current,
      html: html(current, ['Frames', `${Math.round(stanceFrom)} – ${framesAndSecs(to)}`], stanceFrom === 0 && ['Entered as', row.entryStance || 'Grounded'])
    });
  };
  changes.forEach(change => {
    pushStance(change.frame);
    stanceFrom = Math.max(stanceFrom, change.frame);
    current = change.stance;
  });
  pushStance(anim);

  // --- Time stop / motion stop lanes ---
  const frozenInMove = frozenFramesWithin(cut, freezeStart, freeze);
  const timeStop: Segment[] = freeze > 0 ? [{
    from: freezeStart, to: freezeStart + freeze, className: 'move-timeline-freeze', label: '',
    html: html('Time Stop', ['Frames', `${freezeStart} – ${framesAndSecs(freezeStart + freeze)}`], ['Inside the move', framesAndSecs(frozenInMove)],
      ['Note', 'Buffs, cooldowns and game time pause'])
  }] : [];
  const motion: Segment[] = motionStop > 0 ? [{
    from: 0, to: motionStop, className: 'move-timeline-motion', label: '',
    html: html('Motion Stop', ['Frames', `0 – ${framesAndSecs(motionStop)}`], ['Note', "Pauses the other units' moves"])
  }] : [];

  // --- Flags ---
  const waitReasons = (row.offsetReasons || []).filter((r: any) => /wait|lock/i.test(r.label));
  const flags: Flag[] = [{
    at: 0, label: 'Cast',
    html: html('Cast', ['Game time', clock(gameStart)], ['Real time', realClock(realStart)],
      row.waitTime > 0 && ['Waited', `${secs(row.waitTime)}${waitReasons.length ? ` (${waitReasons.map((r: any) => r.label).join(', ')})` : ''}`],
      !!row.input && ['Input', describeBinding(row, keyLabel)])
  }];
  if (cut < base || swappedOut) {
    flags.push({
      at: cut, label: swappedOut ? 'Swap' : 'Cancel', tone: 'cut',
      html: html(swappedOut ? 'Swapped Out' : 'Cut', ['Frame', framesAndSecs(cut)], ['Timing', timingLabel(row)],
        ['Saved', secs(Math.max(0, base - cut))], ['Hits landed', `${allowedHits} of ${hitCount}`])
    });
  }
  const swapAt = move?.swapTiming !== undefined ? Math.max(num(move.swapTiming) ?? 0, GAME_DEFAULTS.swapTime) : undefined;
  if (swapAt !== undefined && swapAt !== cut) {
    flags.push({ at: swapAt, label: 'Swap OK', html: html('Swap Window', ['From', framesAndSecs(swapAt)], ['Note', 'Earliest swap out']) });
  }
  (move?.cancelTimings || []).forEach(ct => {
    if (Number(ct.time) === cut) return;
    flags.push({
      at: Number(ct.time), label: 'Cancel',
      html: html('Cancel Point', ['Frame', framesAndSecs(Number(ct.time))], ct.hits !== undefined && ['Hits kept', ct.hits], !!ct.triggerRule && ['Rule', ct.triggerRule],
        !ct.triggerRule && ['Note', 'For moves that outrank this one'])
    });
  });
  if (move) {
    sortedPrioritySteps(move).forEach(step => flags.push({
      at: step.time, label: 'Prio ↓',
      html: html('Priority Drop', ['Frame', framesAndSecs(step.time)], ['Priority', `${num(move.priority) ?? move.priority} → ${num(step.priority) ?? step.priority}`],
        ['Note', 'Moves that now outrank it can cancel here'])
    }));
  }
  if (freeze > 0) {
    flags.push({ at: freezeStart, label: 'Freeze', html: html('Time Stop Starts', ['Frame', framesAndSecs(freezeStart)], ['Length', framesAndSecs(freeze)]) });
  }
  changes.forEach(change => flags.push({
    at: change.frame, label: `→ ${change.stance}`,
    html: html('Stance Change', ['Frame', framesAndSecs(change.frame)], ['To', change.stance], change.frame > cut && ['Note', 'After the cut: off field'])
  }));
  if (row._swapCancelAt !== undefined) {
    flags.push({ at: row._swapCancelAt, label: 'Swap Cancel', html: html('Swap + Cancel', ['Frame', framesAndSecs(row._swapCancelAt)], ['Note', 'Earliest the returning move cancels it']) });
  }
  if (backAt !== undefined) {
    flags.push({ at: backAt, label: 'Back', html: html('Back On Field', ['Frame', framesAndSecs(backAt)], ['Game time', clock(row.backOnFieldAt)]) });
  }
  if (swappedOut) {
    flags.push({ at: anim, label: 'End', html: html('Animation Ends', ['Frame', framesAndSecs(anim)], ['Game time', clock(gameAt(anim))]) });
  }

  // Greedy lanes by estimated label width.
  // A flag that would run past the right edge sits left of its pole.
  const laneEnds: number[] = [];
  const laidOut = flags
    .map(flag => {
      const x = (pct(flag.at) / 100) * trackWidth;
      const w = (flag.label.length * FLAG_CHAR_REM + FLAG_PAD_REM) * remPx;
      const flipped = x + w > trackWidth;
      return { ...flag, w, flipped, start: flipped ? x - w : x };
    })
    .sort((a, b) => a.start - b.start)
    .map(flag => {
      let lane = laneEnds.findIndex(end => end + FLAG_GAP_PX <= flag.start);
      if (lane === -1) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = flag.start + flag.w;
      return { ...flag, lane };
    });

  // --- Ruler: rotation time from the move's start ---
  const step = TICK_STEPS.find(s => span / s <= 8) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: Tick[] = [];
  // Labeled every step, like the Timeline's tiers: half steps secondary, quarter steps minor.
  for (let k = 0; (k * step) / 4 <= span; k++) {
    const f = (k * step) / 4;
    const tier = k % 4 === 0 ? 'major' : k % 2 === 0 ? 'secondary' : 'minor';
    ticks.push({ frames: f, xPx: pct(f), tier, label: tier === 'major' ? clock(gameAt(f)) : undefined });
  }

  // --- Hits: Timeline dots, stacked; hovering snaps to the nearest like the Timeline's ---
  const inset = SEG_INSET_REM * remPx;
  const dots = stackDots(
    hitOffsets.map((at, i) => ({ xPx: (pct(at) / 100) * trackWidth, yPx: 0, i })).sort((a, b) => a.xPx - b.xPx),
    inset, LANE_REM * remPx - inset * 2
  );
  // The move's own hits, in order (procs left out).
  const ownHits = rowHits(row).filter((hit: any) => !String(hit.title || '').startsWith('[Proc] '));
  const dotHtml = (i: number) => {
    const at = hitOffsets[i];
    const landed = i < allowedHits;
    const hit = landed ? ownHits[i] : undefined;
    return html(`Hit #${i + 1}`, ['Frame', framesAndSecs(at)], ['Game time', clock(gameAt(at))],
      !!hit && ['Damage', `${Math.floor(hit.total || 0).toLocaleString()} dmg`], !landed && ['Note', 'Dropped by the cut']);
  };
  const markActive = useActiveMarker();
  const fieldMove = useFrameMove(e => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(dots, pointer);
    if (nearest !== -1) {
      const d = dots[nearest];
      const at = pointer.toClient(d.xPx, d.yPx);
      markActive(e.currentTarget.querySelector(`[data-dot="${d.i}"]`));
      TooltipManager.showAtPoint(at.x, at.y, dotHtml(d.i));
      return;
    }
    markActive(null);
    const frame = trackWidth > 0 ? (pointer.x / trackWidth) * span : 0;
    const segment = fieldLane.find(seg => frame >= seg.from && frame < seg.to);
    if (segment) TooltipManager.showAtPoint(e.clientX, e.clientY, segment.html);
    else TooltipManager.hide();
  });
  const leaveField = () => {
    fieldMove.cancel();
    markActive(null);
    TooltipManager.hide();
  };
  // Game time on the left, real time (time stops included) on the right.
  const split = (game: string, real: string) => <SplitValue left={['Game', game]} right={['Real', real]} />;
  // `pointer`: the track handles hover itself (Field: hit snapping).
  const lane = (label: string, segments: Segment[], extra?: React.ReactNode, pointer?: React.HTMLAttributes<HTMLDivElement>) => (
    <div className="move-timeline-lane">
      <div className="move-timeline-lane-label caps-label">{label}</div>
      <div className="move-timeline-lane-track" {...pointer}>
        {segments.map((s, i) => (
          <div key={i} className={`move-timeline-seg ${s.className}`} style={{ left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%` }} {...(pointer ? {} : tip(s.html))}>
            {s.label !== undefined && (
              <span className="move-timeline-seg-label">
                {s.label}<span className="move-timeline-seg-duration">{secs(s.to - s.from)}</span>
              </span>
            )}
          </div>
        ))}
        {extra}
      </div>
    </div>
  );

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Move Timeline</div>
      <div className="panel-content-grid move-timeline-info">
        <PanelInfoItem label="Time Start" value={split(clock(gameStart), realClock(realStart))} />
        <PanelInfoItem label="Time End" value={split(clock(gameEnd), realClock(realStart + cut))} />
        <PanelInfoItem label="Duration" value={split(secs(row.gameTimePassed || 0), secs(cut))} />
        <PanelInfoItem label="Wait Before" value={secs(row.waitTime || 0)} />
        {bindings.length > 1 && onInputChoice && (
          // Auto: carry on a hold from the unit's previous move, else the main input.
          <PanelInfoItem label={`Input · ${describeBinding(row, keyLabel)}`} value={
            <SegmentedToggle
              ariaLabel="Input"
              value={row.inputChoice ?? AUTO_INPUT}
              options={[{ value: AUTO_INPUT, label: 'Auto' }, ...bindings.map((b, i) => ({ value: i, label: describeBinding(b, keyLabel) }))]}
              onChange={v => onInputChoice(v === AUTO_INPUT ? undefined : v)}
            />
          } />
        )}
      </div>
      <div className="move-timeline" style={{ '--char-theme-raw': themeColor, '--timeline-header-width': `${LANE_LABEL_REM}rem` } as React.CSSProperties}>
        <div className="move-timeline-flags" style={{ height: `${Math.max(1, laneEnds.length) * FLAG_LANE_REM}rem` }}>
          <div className="move-timeline-lane-label" />
          <div className="move-timeline-lane-track" ref={trackRef}>
            {laidOut.map((flag, i) => (
              <span
                key={i}
                className={`timeline-flag-label move-timeline-flag${flag.tone ? ` is-${flag.tone}` : ''}${flag.flipped ? ' is-flipped' : ''}`}
                style={{ left: `${pct(flag.at)}%`, top: `${flag.lane * FLAG_LANE_REM}rem` }}
                {...tip(flag.html)}
              >
                {flag.label}
              </span>
            ))}
          </div>
        </div>
        {lane('Field', fieldLane, dots.map(d => (
          <div key={d.i} className={`timeline-hit-dot${d.i < allowedHits ? '' : ' is-dropped'}`} data-dot={d.i} style={{ left: d.xPx, top: d.yPx }} />
        )), { onMouseMove: fieldMove.onMove, onMouseLeave: leaveField })}
        {lane('Stance', stance)}
        {timeStop.length > 0 && lane('Time Stop', timeStop)}
        {motion.length > 0 && lane('Motion Stop', motion)}
        <TimelineRuler ticks={ticks} percent />
        <div className="move-timeline-poles">
          {laidOut.map((flag, i) => <span key={i} className={`move-timeline-pole${flag.tone ? ` is-${flag.tone}` : ''}`} style={{ left: `${pct(flag.at)}%` }} />)}
        </div>
      </div>
    </div>
  );
};
