pragma circom 2.2.3;
include "conservation.circom";

// Witness-test harness only. This is deliberately not a deployable verifier.
component main = PrivateConservationV2();
