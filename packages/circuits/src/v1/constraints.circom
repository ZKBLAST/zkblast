pragma circom 2.2.3;

template BitsV1(n) {
    signal input in;
    signal output bits[n];
    var sum = 0;
    var weight = 1;
    for (var index = 0; index < n; index++) {
        bits[index] <-- (in >> index) & 1;
        bits[index] * (bits[index] - 1) === 0;
        sum += bits[index] * weight;
        weight *= 2;
    }
    in === sum;
}

template IsZeroV1() {
    signal input in;
    signal output out;
    signal inverse <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inverse;
    in * out === 0;
}

template LessThanV1(n) {
    signal input left;
    signal input right;
    signal output out;
    component difference = BitsV1(n + 1);
    difference.in <== left + (1 << n) - right;
    out <== 1 - difference.bits[n];
}

template LessEqV1(n) {
    signal input left;
    signal input right;
    signal output out;
    component comparison = LessThanV1(n + 1);
    comparison.left <== left;
    comparison.right <== right + 1;
    out <== comparison.out;
}
