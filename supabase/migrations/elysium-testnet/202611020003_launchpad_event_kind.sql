alter table zkblast_elysium_testnet.protocol_events
  drop constraint if exists protocol_events_event_kind_check;

alter table zkblast_elysium_testnet.protocol_events
  add constraint protocol_events_event_kind_check
  check (event_kind in (
    'pool','swap','position','liquidity','fee','receipt',
    'commitment','root','private_intent','launch'
  ));
