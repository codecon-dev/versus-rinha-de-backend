<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\TransferController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

Route::post('/accounts', [AccountController::class, 'store']);
Route::get('/accounts/{id}/statement', [AccountController::class, 'statement']);

Route::post('/transfers', [TransferController::class, 'store']);
Route::get('/transfers/{id}', [TransferController::class, 'show'])
    ->where('id', '[0-9a-fA-F-]{36}');
