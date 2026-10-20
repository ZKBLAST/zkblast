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

pragma solidity >=0.7.0 <0.9.0;

contract ZKBlastBetaGroth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 14585890041063959478482661621264176886547040436914432204632750462331601717670;
    uint256 constant alphay  = 9740215061054818405806222924118104339332762374890693251583500537778671227236;
    uint256 constant betax1  = 16613821963399421810679836121793748012472765212988507126557243749040399283199;
    uint256 constant betax2  = 13981206370282034085925870015004617053412661293809834787788301485229790166643;
    uint256 constant betay1  = 21029494190072592986202784550805430128783890126497213191554857225035526990708;
    uint256 constant betay2  = 21589661800940125967464435632977321705406953848647824596106508764066424298979;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 4564457454271852824079109003213977578827654347200610957319823113311441860116;
    uint256 constant deltax2 = 5929939219613008962607541749948943798452015618641043188010607031726396084231;
    uint256 constant deltay1 = 4911474026452485087992219042024464823092641631916831714829166473805100700966;
    uint256 constant deltay2 = 14098023454701063286055331533034388458374543144332259808697021045068015609015;

    
    uint256 constant IC0x = 9593017080907504515250902415461760665386707231781503468861990763592266849279;
    uint256 constant IC0y = 3200541513326408376820366942320687479100983882916354877501037951755205228070;
    
    uint256 constant IC1x = 1315447904704191706382593230656612393158584539505808528714425697557850959497;
    uint256 constant IC1y = 15383030702208788824585667164636698807721727879103535717268090611663082390170;
    
    uint256 constant IC2x = 10914931848625013980830072422897436450544262950677110138039995428284471820414;
    uint256 constant IC2y = 5751130536495873000424048529380641188733209349813077866955218936496171466312;
    
    uint256 constant IC3x = 16801192255508185047124634356400547793071237454000138042029199623679232635953;
    uint256 constant IC3y = 2215322858653609286500044345479974022369515737296405804828203683124149952532;
    
    uint256 constant IC4x = 5093293729477811084778384609486429593256301578888878204846777143495102876912;
    uint256 constant IC4y = 6427183563921014339212583363117310162708788776497937301127481273575089322537;
    
    uint256 constant IC5x = 13068073508807378100302167848872568758986097049691128565008957056169767945450;
    uint256 constant IC5y = 14396817658340054435823273970598121407487869374378710020303460766850216591056;
    
    uint256 constant IC6x = 3147953848858208644741101804008696593009213700211866395390991319437038533647;
    uint256 constant IC6y = 21399047513524045520331131221984037295959899836374676625938989837806414136291;
    
    uint256 constant IC7x = 12854343955060499032486754570732153908848937417959109362279392774641701682081;
    uint256 constant IC7y = 2149379120158267401421672296448509476606462628815092057394353112050573618923;
    
    uint256 constant IC8x = 14550370807056950448648293536520207513895468090065903286784694428725605315847;
    uint256 constant IC8y = 19317481454503611056957635044551711296541165261052728220773825389324952064858;
    
    uint256 constant IC9x = 19410149733230779594022555072210167066744990688809868008157679339416177188947;
    uint256 constant IC9y = 6671205724270365459979156960020807176253470176225103771564166491837895846326;
    
    uint256 constant IC10x = 20924669093572238086475276723555648449868801084326715095267876320980698892653;
    uint256 constant IC10y = 2416437544724301207335290449183478334033481145994222937826409719028785956149;
    
    uint256 constant IC11x = 1416887630164551125966838823494313714972681990452788597088019274529103375581;
    uint256 constant IC11y = 11033093171288948510266374445101403631876221561500869264788283780096187702108;
    
    uint256 constant IC12x = 10573369453638016882036178136415370519398985849629923317160098744686532920580;
    uint256 constant IC12y = 18853033397869327500159814927084643090619775518047311736768734898223712765696;
    
    uint256 constant IC13x = 19380414574432215084646318555715773782308604700652367900989166514282721404803;
    uint256 constant IC13y = 5735318532184362397773675562257304087282743116141388672068959117089043467343;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[13] calldata _pubSignals) public view returns (bool) {
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
