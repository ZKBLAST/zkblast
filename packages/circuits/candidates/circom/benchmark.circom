pragma circom 2.2.0;

template Pow5() {
    signal input value;
    signal output out;
    signal squared;
    signal fourth;
    squared <== value * value;
    fourth <== squared * squared;
    out <== fourth * value;
}

template Benchmark() {
    signal input root;
    signal input nullifier;
    signal input secret;
    signal input siblings[32];
    signal input directions[32];
    signal current[33];
    signal left[32];
    signal right[32];
    component hashes[32];
    component nullifierHash = Pow5();
    current[0] <== secret;
    for (var i = 0; i < 32; i++) {
        directions[i] * (directions[i] - 1) === 0;
        left[i] <== current[i] + directions[i] * (siblings[i] - current[i]);
        right[i] <== siblings[i] + directions[i] * (current[i] - siblings[i]);
        hashes[i] = Pow5();
        hashes[i].value <== left[i] + right[i] * 7 + i;
        current[i + 1] <== hashes[i].out;
    }
    current[32] === root;
    nullifierHash.value <== secret + 123;
    nullifierHash.out === nullifier;
}

component main { public [root, nullifier] } = Benchmark();
