//SPDX-License-Identifier: Unlicense

pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

///@title Vesting contract
///@notice Allows linear vesting of Vorpal tokens after a timelock
///@notice The address can have only one vesting schedule

contract VestingSale is Ownable {
    using SafeERC20 for IERC20;

    enum Status {
        Pending,
        Started,
        Finished
    }

    struct VestingSchedule {
        uint256 amount;
        uint256 tokensLeft;
        uint256 unlockingStart;
        uint256 unlockingEnd;
    }

    //Schedules for each address who bought the tokens
    mapping(address => VestingSchedule) schedules;

    IERC20 public vorpal;
    IERC20 public usdc;

    //Lenth of the time while the sale is active
    uint256 public immutable saleLength;
    //USDC price per Vorpal
    uint256 public immutable price;
    //total amount of tokens to sell
    uint256 public immutable saleAmount;
    //total amount of tokens left
    uint256 public totalTokensLeft;

    //Timelock until vesting is enabled
    uint256 public immutable lockPeriod;
    //Duration of vesting
    uint256 public immutable vestingPeriod;

    // timestamp when sale will end
    uint256 public saleEnd;
    //status of the contract
    Status public status;

    ///@notice Contract status differs from status required to run the function.
    error WrongContractStatus(Status expected, Status actual);
    ///@notice The sale period did not finish yet
    error SalePeriodNotEnded();
    ///@notice Number of tokens for transaction is too small
    error InsufficientBalance();
    ///@notice Vesting did not start yet
    error VestingTimelocked();
    ///@notice Withdrawing too many tokens
    error TooManyTokensRequested(); 
    ///@notice Withdrawing more tokens than left
    error NotEnoughTokensLeft();

    ///@notice Check if the sale has started
    modifier onlyStarted() {
        if (status != Status.Started) {
            revert WrongContractStatus(Status.Started, status);
        }
        _;
    }

    ///@notice Check if the sale has started
    modifier onlyFinished() {
        if (status != Status.Finished) {
            revert WrongContractStatus(Status.Started, status);
        }
        _;
    }

    constructor(
        IERC20 _vorpal,
        IERC20 _usdc,
        uint256 _price,
        uint256 _saleAmount,
        uint256 _saleLength,
        uint256 _lockPeriod,
        uint256 _vestingPeriod
    ) {
        vorpal = _vorpal;
        usdc = _usdc;
        price = _price;
        saleAmount = _saleAmount;
        saleLength = _saleLength;
        lockPeriod = _lockPeriod;
        vestingPeriod = _vestingPeriod;

        totalTokensLeft = _saleAmount;

        status = Status.Pending;
    }

    ///@notice Swaps USDC into Vorpal and locks it
    ///@param amount - amount of USDC to buy Vorpal tokens
    function buyTokens(uint256 amount) external onlyStarted {
        if (amount < 1e18) {
            revert InsufficientBalance();
        }

        usdc.safeTransferFrom(address(msg.sender), address(this), amount);

        uint256 vorpalAmount = amount / price * 1e18;
        uint256 unlockingStart = block.timestamp + lockPeriod;
        uint256 unlockingEnd = unlockingStart + vestingPeriod;
        schedules[msg.sender] = VestingSchedule(
            vorpalAmount,
            vorpalAmount,
            unlockingStart,
            unlockingEnd
        );

        totalTokensLeft -= vorpalAmount;
    }

    ///@notice Allows to withdraw Vorpal tokens
    ///@param amount - amount of Vorpal tokens to withdraw
    function withdrawTokens(uint256 amount) external {
        VestingSchedule storage schedule = schedules[msg.sender];

        if(amount > schedule.amount) {
            revert TooManyTokensRequested();
        }

        uint256 unlockedTokens = getUnlockedTokens(schedule);
        uint256 tokensLeft = schedule.tokensLeft;
        if (unlockedTokens > tokensLeft) {
            revert NotEnoughTokensLeft();
        }


        schedule.tokensLeft -= tokensLeft;
        vorpal.safeTransfer(address(msg.sender), amount);
    }

    ///@notice Changes the state of the contract ot allow users to buy tokens
    function startSale() external onlyOwner {
        if (status != Status.Pending) {
            revert WrongContractStatus(Status.Pending, status);
        }
        status = Status.Started;
        saleEnd = block.timestamp + saleLength;
    }

    ///@notice Changes the state of the contract to stop the selling of tokens
    function finishSale() external onlyOwner onlyStarted {
        if (block.timestamp < saleEnd) {
            revert SalePeriodNotEnded();
        }
        status = Status.Finished;
    }

    ///@notice Withdraws unsold Vorpal
    function withdrawRemainingVorpal(address to)
        external
        onlyOwner
        onlyFinished
    {
        vorpal.safeTransfer(to, totalTokensLeft);
    }

    ///@notice Withdraw collected USDC
    function withdrawUSDC(address to) external onlyOwner onlyFinished {
        uint256 usdcBalance = usdc.balanceOf(address(this));
        usdc.safeTransfer(to, usdcBalance);
    }

    ///@notice Returns a schedule of a caller
    function getSchedule(address holder)
        external
        view
        returns (VestingSchedule memory)
    {
        return schedules[holder];
    }

    ///@notice Read-only wrapper for internal getUnlockedTokens
    function getUnlockedTokens(address holder) external view returns (uint256) {
        VestingSchedule memory schedule = schedules[holder];
        return getUnlockedTokens(schedule);
    }

    ///@notice Calculates amount of tokens user can withdraw
    function getUnlockedTokens(VestingSchedule memory schedule)
        internal
        view
        returns (uint256)
    {
        uint256 currentTime = block.timestamp;
        if (currentTime < schedule.unlockingStart) {
            revert VestingTimelocked();
        }
        uint256 rate = schedule.amount / vestingPeriod;
        return (currentTime - schedule.unlockingStart) * rate;
    }
}
