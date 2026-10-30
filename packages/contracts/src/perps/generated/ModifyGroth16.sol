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

contract ModifyGroth16 {
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
    uint256 constant deltax1 = 18106585606546708414042981372372806064238486503577644907075860378759296175186;
    uint256 constant deltax2 = 7266045972293583217160664966159236204881078586557608777745639118933085584720;
    uint256 constant deltay1 = 15635553087594265756978700321362199838118094014124127996363447564780215152816;
    uint256 constant deltay2 = 14188084226687040467807170637329046889350704516825531302474989357184707975795;

    
    uint256 constant IC0x = 17677523448312881868056918457128836797876820786451331197969633974921514561953;
    uint256 constant IC0y = 6893414702329881578505094142521362549111881702079586393784261208723357505285;
    
    uint256 constant IC1x = 21406208482382933332857524979528150028699223571746131128590836093698041517295;
    uint256 constant IC1y = 5496196767438157769481949331817775025221156658153304474411645595375080397265;
    
    uint256 constant IC2x = 20305365199744138447833625470115479360681045023414372724140896036173446664490;
    uint256 constant IC2y = 21073315756791575567253262411025099021475933407057011621949236833641481101384;
    
    uint256 constant IC3x = 13607124609396936379064214525163566470687417955224733754704590182317226278509;
    uint256 constant IC3y = 12640770059676666521248966761505822002311098902595444000569778490851845151788;
    
    uint256 constant IC4x = 19191544751459686127879610509341270395821060619424699808727754307163038351245;
    uint256 constant IC4y = 12483180109222221839847528020058212028066714630892713547009941079808483199900;
    
    uint256 constant IC5x = 4941655145919489977646620143978425751668253513015616782964738812125844845891;
    uint256 constant IC5y = 10263918837317611490650804308835923793421944332985474246387017031162779695521;
    
    uint256 constant IC6x = 18059200716758078057021365918073916930215690531606876386942042588421070934799;
    uint256 constant IC6y = 6072651788765244762526955300784031761018090866107408704611342773041028874076;
    
    uint256 constant IC7x = 7112268613294545356492773534866172407285004667973533680077933805894172109917;
    uint256 constant IC7y = 9377550064505715812726274105745447697154128547648297663128585999395558454888;
    
    uint256 constant IC8x = 15502440420707791557403629939749884599050674250669549312983692376428471284444;
    uint256 constant IC8y = 20668555121277071557333537212153640997140262510864402586656749151122579551349;
    
    uint256 constant IC9x = 15876420202488110812077529152277269810563541820548300471292668270721448717403;
    uint256 constant IC9y = 15332021149410708704729807130570895374197041798487306571713243619411410161728;
    
    uint256 constant IC10x = 7855830299301432184496954581899425691317869932715083815303550702446989475787;
    uint256 constant IC10y = 10178747602528900356549661792260434391515656611746211325639805854961107871515;
    
    uint256 constant IC11x = 10871099854684730221626304743330698066071235134973909944415026057033186066387;
    uint256 constant IC11y = 15672775007445230435463996081845891826846306812279171361490574132202488762198;
    
    uint256 constant IC12x = 11087873208885201221234203206589442440467408380167352785048053247439615729921;
    uint256 constant IC12y = 12742798171982594123981655351763668263124919986890886545066838478584796955434;
    
    uint256 constant IC13x = 6194890734296154702408906452028781692336488885651141449883846872534476109661;
    uint256 constant IC13y = 11416525631814754681205098753632295826278060722352008090648379561489855757714;
    
    uint256 constant IC14x = 7084084292402485003117651680860755014816713641669319534506749237456092702239;
    uint256 constant IC14y = 1238055649829104828511473380812912966863725332235814458165523783551612738848;
    
    uint256 constant IC15x = 10564169332937347883828602108370849934164963564843168357868065469814530302004;
    uint256 constant IC15y = 12605040681184595335649023267483458754013600699195172372673608317579629458130;
    
    uint256 constant IC16x = 12728940118522122378711809374228886786173270316951752964065477289123132862143;
    uint256 constant IC16y = 15331988649463615966441097774228965037163559727247133631974471821968046566741;
    
    uint256 constant IC17x = 13551701527274171010183899367657891893974129969592585014614934751381206462065;
    uint256 constant IC17y = 10314804486515984827724687805469507973911505701300776540914430594023360088398;
    
    uint256 constant IC18x = 12246125508149787456147268138255663811342412367047830928000654974756915972085;
    uint256 constant IC18y = 14321237188176185794857415223180443371874520847139417478523621231172395050657;
    
    uint256 constant IC19x = 20074803363152306420776487045048355256178178846987203460310480913989237185854;
    uint256 constant IC19y = 9236164178088511751630402750902971516580670135346705428718420950517280813282;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[19] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC18x, IC18y, calldataload(add(pubSignals, 544)))
                
                g1_mulAccC(_pVk, IC19x, IC19y, calldataload(add(pubSignals, 576)))
                

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
            
            checkField(calldataload(add(_pubSignals, 544)))
            
            checkField(calldataload(add(_pubSignals, 576)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
