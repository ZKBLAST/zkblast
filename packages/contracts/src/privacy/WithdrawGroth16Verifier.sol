// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity 0.8.26;

contract WithdrawGroth16Verifier {
    // Scalar field size
    uint256 constant r =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax =
        9824359655212486034780218291471746425882827393639794707745843329226455767846;
    uint256 constant alphay =
        9789230505887730140344085100543142087739742205312395310728906810043760448923;
    uint256 constant betax1 =
        16320732306433159422180117456334758406081379618331209844819923138520430476225;
    uint256 constant betax2 =
        6759326250683367522944705967752289692120238123444053383412465831955662868394;
    uint256 constant betay1 =
        10286611226766062732033334199355094041873333430816207669135795206623018028421;
    uint256 constant betay2 =
        20863559960996833187449103462031920791113904288223477332725790139018196131679;
    uint256 constant gammax1 =
        11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 =
        10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 =
        4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 =
        8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 =
        939069124332119149553062801345301314036119137238498463726485028204434645838;
    uint256 constant deltax2 =
        2624740549918174054625070658703793262241368645357919680429112703854441387183;
    uint256 constant deltay1 =
        15254037153538519625920660943482156023788113710858623231984167603077627443472;
    uint256 constant deltay2 =
        15055811096299609400963921702784111905115965033236791766096690725970427745104;

    uint256 constant IC0x =
        21372688577150107587691189587143695484655593310380096727590729874436465670606;
    uint256 constant IC0y =
        16198270405435664787995548201246466677532492441103643402854365362296577057672;

    uint256 constant IC1x =
        17322670135437114274848825582516505885693432543198268872191847095251331272935;
    uint256 constant IC1y =
        10714376087555309034882354971183163385927987500772702680376393413345369929048;

    uint256 constant IC2x =
        13657536412222454355602890834729696937168156143037771165796260004219227808064;
    uint256 constant IC2y =
        19200246570634649909415747189741255817010310181852134760269637582799110791955;

    uint256 constant IC3x =
        8020476696992009069582668013725768282556733966562512070179870347444834042765;
    uint256 constant IC3y =
        9752635887140777645793152668361670294861909604049499649565871930257278437503;

    uint256 constant IC4x =
        7498737521783921123278985368575819786394276908366540213918338987340207567068;
    uint256 constant IC4y =
        19317995469870378513674458965905949750032987411072582995366253261621998589134;

    uint256 constant IC5x =
        18352235827820810901484099762105593479382490923500277287819291789965957090734;
    uint256 constant IC5y =
        637420730381976567127152591704460944545314476487179755386347280700811542529;

    uint256 constant IC6x =
        2382576675822200249196017553761114005414981313736453178516196431401785575759;
    uint256 constant IC6y =
        7057518837207297352312448722592564148992431979989123254602302701854967174273;

    uint256 constant IC7x =
        19696956969455841900162583311199699383309393153692161233456954603536068955459;
    uint256 constant IC7y =
        16528843700083981510978651287106571480782978006208157381653057622570694295080;

    uint256 constant IC8x =
        16377039048969420834819186728570126229164665695797034189910428807579451595035;
    uint256 constant IC8y =
        6997425330358848163161301071738885157173127954940824633415224101443445068216;

    uint256 constant IC9x =
        17880120330379333909208682529896072160755848090617313560546297085307675565363;
    uint256 constant IC9y =
        6789535189703923248302511615960967757165354375642299519275837889576039489651;

    uint256 constant IC10x =
        10695308045237997145082420643619534318692356565823805227903886397582885647197;
    uint256 constant IC10y =
        1603415294830398329416835258743913239143014423468251942299044742644869756178;

    uint256 constant IC11x =
        14663408301056878371194134075917429114711352971602080116354442632659297002619;
    uint256 constant IC11y =
        10199055134086170691551368940980514354622986501433557269586567847184234733870;

    uint256 constant IC12x =
        14333780206892774465828346215178072717138411037483437974134485366390100329101;
    uint256 constant IC12y =
        16918360076099528987395666389255317636527778760300726000249948889009857455185;

    uint256 constant IC13x =
        13457673978995927106184344344868241208231108517946420402641393413455187229295;
    uint256 constant IC13y =
        15160031590628900822432518185467376605752853119614870196344254700226365097122;

    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[13] calldata _pubSignals
    ) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x

                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))

                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))

                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))

                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))

                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))

                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))

                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))

                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))

                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))

                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))

                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))

                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))

                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))

                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)

                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F

            checkField(calldataload(add(_pubSignals, 0)))

            checkField(calldataload(add(_pubSignals, 32)))

            checkField(calldataload(add(_pubSignals, 64)))

            checkField(calldataload(add(_pubSignals, 96)))

            checkField(calldataload(add(_pubSignals, 128)))

            checkField(calldataload(add(_pubSignals, 160)))

            checkField(calldataload(add(_pubSignals, 192)))

            checkField(calldataload(add(_pubSignals, 224)))

            checkField(calldataload(add(_pubSignals, 256)))

            checkField(calldataload(add(_pubSignals, 288)))

            checkField(calldataload(add(_pubSignals, 320)))

            checkField(calldataload(add(_pubSignals, 352)))

            checkField(calldataload(add(_pubSignals, 384)))

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
            return(0, 0x20)
        }
    }
}
