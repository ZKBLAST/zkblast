alter table zkblast_testnet.protocol_events
  drop constraint protocol_events_event_kind_check;

alter table zkblast_testnet.protocol_events
  add constraint protocol_events_event_kind_check
  check (event_kind in ('pool','swap','position','liquidity','fee','receipt','commitment','root'));
