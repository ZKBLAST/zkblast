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

contract CloseGroth16 {
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
    uint256 constant deltax1 = 4644725744249520921962032885819456109174240658887719473626755397596351442678;
    uint256 constant deltax2 = 13520713759030326872777862339661749971038128081734509125775861698876584195174;
    uint256 constant deltay1 = 7582561906472910875665992713728002478185503445947796205982326269318186645268;
    uint256 constant deltay2 = 17611948083182873474767386499274734092543370511360671169350510328567046082765;

    
    uint256 constant IC0x = 13039234694852016286819905701736094956309253191435357254139054827407254812039;
    uint256 constant IC0y = 18213223640486587591436802470410520325523633879597933654267752013444832181105;
    
    uint256 constant IC1x = 4543294631554002800436450672235008716739318305517505304929488099772868445028;
    uint256 constant IC1y = 21547968489305382754865197881343021791789047659646631350543718399252776060367;
    
    uint256 constant IC2x = 17012718119612369111456584293100531456561514787648345857172122520703911885876;
    uint256 constant IC2y = 11524627509918874126215468267109602457140523009695825015732404479899892643784;
    
    uint256 constant IC3x = 17073285463164519485471275563441052224876827492916956600112086930700701917607;
    uint256 constant IC3y = 15037883806756015503393691100757177593885342697964917280972546886600801180761;
    
    uint256 constant IC4x = 13590268942133934083703239298201411588020665231183706385903587835954377817842;
    uint256 constant IC4y = 3187398691118101123636566483973490904474086479481103446650418712022085506780;
    
    uint256 constant IC5x = 12838977532701281136971689654526698399134886892117650597961526513974322925036;
    uint256 constant IC5y = 15127802386975013988187738126207200659422830538531546753369460160288822015374;
    
    uint256 constant IC6x = 20929122821859441551903307186957546617543117119338270352711653642075860938993;
    uint256 constant IC6y = 6227283554695933565172837274820762660822983314191959730909607529739565544544;
    
    uint256 constant IC7x = 4858458268076401713245129189257954653398511555821272158195888106242864602776;
    uint256 constant IC7y = 4651576992495175794668208148849480925091466041765863652380335113076444362545;
    
    uint256 constant IC8x = 21177798847388540340469075698127973107818438522146297805152352185045462136574;
    uint256 constant IC8y = 6067866707860226252721566177669057688443810970030340517715039607905439956585;
    
    uint256 constant IC9x = 9959911631156703122483734963818301823785313023536657761302007305733043745978;
    uint256 constant IC9y = 5371400673351106457280119671758484535693739231227778652476992498121327570285;
    
    uint256 constant IC10x = 13916282136975073387990513815279231229798049947622601038780945557807806468895;
    uint256 constant IC10y = 17725157727772138136109550766336421171685116140313026837439471671009015218823;
    
    uint256 constant IC11x = 2132351944236694438043714604569721268659319667682981602948763701631404342791;
    uint256 constant IC11y = 4221281901246476138391773075290685436182717850684903783774176341879255616943;
    
    uint256 constant IC12x = 3891923954611672340644760719474301289700937191250183649272737741114657863819;
    uint256 constant IC12y = 11936391977831587711069020118707922532004870267088984949984070066860099483717;
    
    uint256 constant IC13x = 20786999234705782281416839776671102334503887055327242545009414258556062673046;
    uint256 constant IC13y = 9915418829758681093591381785119088085621069389631077865045759544760907953977;
    
    uint256 constant IC14x = 12804147689801556874277984517771767721030358893841115855132975072954223788073;
    uint256 constant IC14y = 10107471106739978946517471254500350463573848683572432218139231765552010097026;
    
    uint256 constant IC15x = 18187085435462222635663671030237786135372010458002436829350844842371118495460;
    uint256 constant IC15y = 12738413910715377918906920782293606049904751209665665937254194958875638435222;
    
    uint256 constant IC16x = 689485630972237720239852447292089826947609662539345518377279388298580668702;
    uint256 constant IC16y = 18554297625649402679571792541454049535474638003686218508151663565037096358248;
    
    uint256 constant IC17x = 8283985107755585634016237652359672038901646475876767584561411670141741237017;
    uint256 constant IC17y = 9238709632469283522439632816919221734170183719308168671391888630986422594421;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[17] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC17x, IC17y, calldataload(add(pubSignals, 512)))
                

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
            
            checkField(calldataload(add(_pubSignals, 512)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
