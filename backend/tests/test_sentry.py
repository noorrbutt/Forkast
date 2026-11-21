from __future__ import annotations

from unittest.mock import Mock

import sentry_sdk

import app.main as main


def test_sentry_init_disables_local_variables(
    monkeypatch,
) -> None:
    monkeypatch.setattr(main.settings, "sentry_dsn", "https://public@example.ingest.sentry.io/1")
    init = Mock()
    monkeypatch.setattr(sentry_sdk, "init", init)

    main._init_sentry()

    init.assert_called_once()
    assert init.call_args.kwargs["dsn"] == main.settings.sentry_dsn
    assert init.call_args.kwargs["include_local_variables"] is False
