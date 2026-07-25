<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\Transfer;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AccountController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'id' => ['required', 'string', 'max:64'],
            'balance' => ['required', 'integer', 'min:0'],
        ]);

        try {
            $account = Account::create([
                'id' => $data['id'],
                'balance' => $data['balance'],
            ]);
        } catch (QueryException $e) {
            if ($e->getCode() === '23505') {
                return response()->json(['error' => 'account_already_exists'], 409);
            }
            throw $e;
        }

        return response()->json([
            'id' => $account->id,
            'balance' => (int) $account->balance,
        ], 201);
    }

    public function statement(string $id): JsonResponse
    {
        $account = Account::find($id);

        if ($account === null) {
            return response()->json(['error' => 'account_not_found'], 404);
        }

        $transfers = Transfer::query()
            ->where('status', 'completed')
            ->where(function ($q) use ($id) {
                $q->where('payer_id', $id)->orWhere('payee_id', $id);
            })
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (Transfer $t) => $t->toApi());

        return response()->json([
            'accountId' => $account->id,
            'balance' => (int) $account->balance,
            'transfers' => $transfers,
        ]);
    }
}
