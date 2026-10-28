"""Explicit washer-guide edges executed by pytransitions.

Scene evidence is checked in state_machine before calling this graph. The graph
only decides whether a requested step change is legal; it never infers a step.
"""

from __future__ import annotations

from transitions import Machine

from .models import Step


_EDGES: tuple[tuple[str, Step | str, Step], ...] = (
    ("inlet_found", Step.FIND_INLET, Step.OPEN_CAP),
    ("cap_opened", Step.OPEN_CAP, Step.CONFIRM_PRODUCT),
    ("product_matched", Step.CONFIRM_PRODUCT, Step.POUR),
    ("pour_observed", Step.POUR, Step.FINISH),
    ("pour_unseen", Step.POUR, Step.FINISH),
    ("retry_pour", Step.FINISH, Step.POUR),
    ("bottle_changed", Step.POUR, Step.CONFIRM_PRODUCT),
    ("bottle_changed", Step.FINISH, Step.CONFIRM_PRODUCT),
    ("record", Step.FINISH, Step.RECORDED),
    ("restart", "*", Step.FIND_INLET),
)


def next_step(current: Step, event: str) -> Step:
    """Raise MachineError for an illegal edge instead of silently skipping work."""
    holder = type("StepHolder", (), {})()
    machine = Machine(
        model=holder,
        states=[step.value for step in Step],
        initial=current.value,
        auto_transitions=False,
        send_event=False,
    )
    for trigger, source, target in _EDGES:
        machine.add_transition(trigger, source.value if isinstance(source, Step) else source, target.value)
    getattr(holder, event)()
    return Step(holder.state)


def next_pause_state(paused: bool, event: str) -> bool:
    """Pause and resume are idempotent triggers in the separate control graph."""
    holder = type("PauseHolder", (), {})()
    machine = Machine(
        model=holder,
        states=["running", "paused"],
        initial="paused" if paused else "running",
        auto_transitions=False,
    )
    machine.add_transition("pause", "*", "paused")
    machine.add_transition("resume", "*", "running")
    getattr(holder, event)()
    return holder.state == "paused"
