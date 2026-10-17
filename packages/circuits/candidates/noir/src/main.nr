fn pow5(value: Field) -> Field {
    let squared = value * value;
    squared * squared * value
}

fn main(
    root: pub Field,
    nullifier: pub Field,
    secret: Field,
    siblings: [Field; 32],
    directions: [bool; 32],
) {
    let mut current = secret;
    for i in 0..32 {
        let left = if !directions[i] { current } else { siblings[i] };
        let right = if !directions[i] { siblings[i] } else { current };
        current = pow5(left + right * 7 + i as Field);
    }
    assert(current == root);
    assert(pow5(secret + 123) == nullifier);
}
