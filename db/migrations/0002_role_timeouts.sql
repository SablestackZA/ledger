-- Role settings reach connections behind a transaction pooler; startup parameters do not.
alter role ledger_app set statement_timeout = '5s';
alter role ledger_app set idle_in_transaction_session_timeout = '10s';
