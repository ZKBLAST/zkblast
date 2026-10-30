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

contract ClaimGroth16 {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 8504121146635867512068465213695398680374680715693964854561182987657482276536;
    uint256 constant alphay  = 7476790209627509755283812575338043604713101205242892162431101032269087174768;
    uint256 constant betax1  = 2549150777547588611975853344696360074692224144408069890971210977760517418584;
    uint256 constant betax2  = 1817539371210932303176254244136948539492242674661491810350065251006096377089;
    uint256 constant betay1  = 14940589157098109804815931559873482335304558673040776455003765906854891405008;
    uint256 constant betay2  = 19156087510947323193228371934550713166303085314348903488824860322000719601498;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 16934656272106924012483123123936799076298566348187232390931660672052635192425;
    uint256 constant deltax2 = 13197106063734463843393613379522116993615555260753356193473866309631177266899;
    uint256 constant deltay1 = 8441226306971760094968803102366242324645863743376321884548429495771317999503;
    uint256 constant deltay2 = 11162088075269153446024660994469422222965655763703651483315815412657254878566;

    
    uint256 constant IC0x = 21826716864689683705400269739908088798427901808725254235049175291747036715804;
    uint256 constant IC0y = 9607685334405973089481580187040852525488406759358881390674365781407697304324;
    
    uint256 constant IC1x = 13181296788659017869332951491124544979905554283334293949377940721409679111024;
    uint256 constant IC1y = 19523589369680334969544928042168733684386375730054045479302288279164559505000;
    
    uint256 constant IC2x = 1420096244307479488897865087655334987934713756680095107348661731370290131895;
    uint256 constant IC2y = 6927844957974186322815316587979127609201581403191530520592640113475850506415;
    
    uint256 constant IC3x = 19556985595754672089137194772597852455809017740078934155979515424530631394288;
    uint256 constant IC3y = 20360705610500337275703501577997200256232867059943576828361365325839094117421;
    
    uint256 constant IC4x = 11410298450907607560329504229501650905870043192371523784027854791221308200575;
    uint256 constant IC4y = 15718857815513082032129555622749232471324520453455069596795846833369167405578;
    
    uint256 constant IC5x = 18082939514206688811609048035313219879537495289787104685423888747572968277705;
    uint256 constant IC5y = 18225833421651894926571323666790160293531307483936812446293349629814986246882;
    
    uint256 constant IC6x = 13497280343090796179778654567126557676130513136881926407764585605972797554383;
    uint256 constant IC6y = 19665215611971202390222286473726074322662144721056750504152465413552768431588;
    
    uint256 constant IC7x = 16118504844875904974076451810310329353739873926578594148949939036561948433735;
    uint256 constant IC7y = 7716619788624900901605675435406731874496384129093016756512493861308124873854;
    
    uint256 constant IC8x = 3156104257796730319020728651394668214322823600113879191558669105118854366168;
    uint256 constant IC8y = 20054430191970441172150010465782617990829279596881277406961797523029970215243;
    
    uint256 constant IC9x = 20994266217830859211960108665550696350807248913819601070311016839591865678344;
    uint256 constant IC9y = 324499101672818932017541919519742909588767168856144376449071301017156101136;
    
    uint256 constant IC10x = 4070208654630754183509253121643542472293534113498797462820511368143086137384;
    uint256 constant IC10y = 14608542646301336307731965098375079978610827064250790357699157020020284724731;
    
    uint256 constant IC11x = 5898681759066730379508719542776630382006037133450700224668815283587449184771;
    uint256 constant IC11y = 6966420672906709201145972902698300256813132758471731006914913484850628215231;
    
    uint256 constant IC12x = 16890865501593180904428534452977723535484814456806354743399820028662300259694;
    uint256 constant IC12y = 19841306602486281826670366202810978931207651803449840102162437715363485939322;
    
    uint256 constant IC13x = 19653931466691174584413475096256485992825145054069995577168818970672831411980;
    uint256 constant IC13y = 19150576356658842142835097580430367325552144545623301439863641389946135238578;
    
    uint256 constant IC14x = 3541874105568964316809580613662019246812504610959910170159757262444752589361;
    uint256 constant IC14y = 1755375338799417721893864046545524364675873736539204135214285803022867996079;
    
    uint256 constant IC15x = 2645516010706760308407152741814887249463879382680363267485504174590888519585;
    uint256 constant IC15y = 19429949121453442776144472297494175635714681279799097980812242641465569943169;
    
    uint256 constant IC16x = 1606285352454712643555504471877483548332687507485995092302007423594343437877;
    uint256 constant IC16y = 14515054540848405089384155748480563438734980911055752308032132327240709433203;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[16] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                
                g1_mulAccC(_pVk, IC15x, IC15y, calldataload(add(pubSignals, 448)))
                
                g1_mulAccC(_pVk, IC16x, IC16y, calldataload(add(pubSignals, 480)))
                

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
            
            checkField(calldataload(add(_pubSignals, 416)))
            
            checkField(calldataload(add(_pubSignals, 448)))
            
            checkField(calldataload(add(_pubSignals, 480)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
