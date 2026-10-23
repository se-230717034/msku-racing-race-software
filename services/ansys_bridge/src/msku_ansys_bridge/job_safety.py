"""Bounded stage monitoring; a timed-out gRPC call is never treated as cancelled."""

from __future__ import annotations

import threading
from collections.abc import Callable


class StageWatchdog:
    def __init__(self, seconds: float, on_timeout: Callable[[str], None]) -> None:
        if seconds <= 0:
            raise ValueError("Stage timeout must be positive")
        self._seconds = seconds
        self._on_timeout = on_timeout
        self._lock = threading.Lock()
        self._generation = 0
        self._timer: threading.Timer | None = None
        self._active = True

    def pulse(self, stage: str) -> None:
        with self._lock:
            if not self._active:
                return
            self._generation += 1
            generation = self._generation
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._seconds, self._fire, args=(generation, stage))
            self._timer.daemon = True
            self._timer.start()

    def stop(self) -> None:
        with self._lock:
            self._active = False
            self._generation += 1
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def _fire(self, generation: int, stage: str) -> None:
        with self._lock:
            if not self._active or generation != self._generation:
                return
            self._active = False
            self._timer = None
        self._on_timeout(stage)
