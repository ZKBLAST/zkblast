// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Stable custom errors shared by DBC contracts and client decoders.
interface IDbcErrors {
    error AlreadyGraduated();
    error CurveCapacityExceeded();
    error DeadlineExpired();
    error FeeSplitInvalid();
    error GraduationNotReady();
    error IdenticalAssets();
    error InvalidAccount();
    error InvalidAmount();
    error InvalidAsset();
    error InvalidConfiguration();
    error InvalidLifecycle();
    error InvalidMigration();
    error InvalidRecipient();
    error InvalidTemplate();
    error LiabilityUnderfunded();
    error MigrationInProgress();
    error PoolAlreadyExists();
    error ReserveCoverageFailed();
    error SlippageExceeded();
    error TemplateAlreadyUsed();
    error TemplateDisabled();
    error TokenTransferMismatch();
    error UnauthorizedAdapter();
    error UnsupportedAssetBehavior();
}
