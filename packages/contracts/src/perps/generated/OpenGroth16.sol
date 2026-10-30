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

contract OpenGroth16 {
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
    uint256 constant deltax1 = 357003698009501195189517939548635378648197053713319067844336709213864631284;
    uint256 constant deltax2 = 10259169093942279860331971911813611208944002442792929094286619293474367741420;
    uint256 constant deltay1 = 13525622999981370028471495943068787484261081577284734358049401651838253726843;
    uint256 constant deltay2 = 12320238960272218503447392365260641532991147282552808023335331069480151597023;

    
    uint256 constant IC0x = 1815286164693553673379164062745629400992506685001885091852311086869507640288;
    uint256 constant IC0y = 10174041094002722120670002666160114329680075054684603183818938411114817364511;
    
    uint256 constant IC1x = 18072795801229697468187151454796932810534129274824811252254167314269661236562;
    uint256 constant IC1y = 3272651345236179771361182836651174893027467252667035233320547517498586660927;
    
    uint256 constant IC2x = 11895278339755130875442179600877423778507992753722561350622699241945107348746;
    uint256 constant IC2y = 17929941452495719803691661938007869119637207355043684892652801440242815154411;
    
    uint256 constant IC3x = 17310542139693891701275254553005293478389638021286933325941210914422511319779;
    uint256 constant IC3y = 18704889445193138374172969526478481721773183760208840329574608925897839759895;
    
    uint256 constant IC4x = 13177050241999203439268975894458742295741106503118814138746173784351523880291;
    uint256 constant IC4y = 4425893597333163153130368240364857022570172946005773162672578610196017321325;
    
    uint256 constant IC5x = 4399451898264960437821903069279094325499136460516647203259929152345314214358;
    uint256 constant IC5y = 19827623469145067755606646949988176675161298041053772209778153065353230429256;
    
    uint256 constant IC6x = 5880018994142453282059492160539435858132265963033666421831040476070834745766;
    uint256 constant IC6y = 255816412307309894270418212877384570232232576841284814012151291331372595349;
    
    uint256 constant IC7x = 11013976547476691113615178542235091957407166934531652844132692314875862393771;
    uint256 constant IC7y = 14875248079142079549656827490629707349337293963668868835926727535618950017710;
    
    uint256 constant IC8x = 1535537051458993412272619203165965697384789953452664280439235562105269701936;
    uint256 constant IC8y = 17980825811832128889901235722313413081637035305225477370539269977814471990982;
    
    uint256 constant IC9x = 21472653294318965455036017889925815402768365428930664526929622947961444758193;
    uint256 constant IC9y = 17050422143897729533494457590184879065028767200601824466468348265870540766551;
    
    uint256 constant IC10x = 2974941697253978392133284931901830653608456189035543075769019807569889686067;
    uint256 constant IC10y = 3558832468862775217396842103736435714828396671594858909913403822213693301184;
    
    uint256 constant IC11x = 4572949719146389173911545743286287396559264613244621073542997495792258256114;
    uint256 constant IC11y = 19680666288729041818911276816293929377822581418212554289076904713326388129002;
    
    uint256 constant IC12x = 16943381382809059846706083510745372879960154845862091448000885860691964122410;
    uint256 constant IC12y = 10894477428623115387926489187189121557493588715731593866536432735283968819704;
    
    uint256 constant IC13x = 6920808873345707798978459752303250084610148185983188206661417615868868350679;
    uint256 constant IC13y = 15679257479498768658317623118433418509414395631925744528078833932726566591822;
    
    uint256 constant IC14x = 4561096247434899947075408007258451966436100669438891512059043151900960176429;
    uint256 constant IC14y = 4628102109746698398775074036422364412065630052206887936098528666607458309624;
    
    uint256 constant IC15x = 9966567415240075299600212889665589917360696502192300846229192720029984307125;
    uint256 constant IC15y = 11175852032551400473333732416377920135541817601347459028098314381494365599390;
    
    uint256 constant IC16x = 9182094780807309391179135275816186051074163440916949314242814214815618377546;
    uint256 constant IC16y = 9220924652417037723086240729925034586506460645221598616399439589395831943536;
    
    uint256 constant IC17x = 6247714405779679628969139696042451098746136821953486025899732617134741218210;
    uint256 constant IC17y = 17737081665026961805486735325787467797676954466574145770768562145498805377495;
    
    uint256 constant IC18x = 371161012424688594433800487796483542705640284291475800662960657261972626355;
    uint256 constant IC18y = 3843620824996225672651011759379320271074743928610912726858096415610599334957;
    
    uint256 constant IC19x = 3744190090327571337051828893457430039237162096004576016614472278962963328684;
    uint256 constant IC19y = 18569976406126329674262350422178169878050359345036420473042214571444451594684;
    
    uint256 constant IC20x = 15442490438372815679183133300031411992581114790619520436327299657582212912712;
    uint256 constant IC20y = 21299413892571444194073408813636895490396653439786378601256644590851325715917;
    
    uint256 constant IC21x = 20170938820380706317290748779860616723896152918596441631326505308340864673920;
    uint256 constant IC21y = 16695970289655276129387562200339091392953273398095457095479935800870876726866;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[21] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC20x, IC20y, calldataload(add(pubSignals, 608)))
                
                g1_mulAccC(_pVk, IC21x, IC21y, calldataload(add(pubSignals, 640)))
                

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
            
            checkField(calldataload(add(_pubSignals, 608)))
            
            checkField(calldataload(add(_pubSignals, 640)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
