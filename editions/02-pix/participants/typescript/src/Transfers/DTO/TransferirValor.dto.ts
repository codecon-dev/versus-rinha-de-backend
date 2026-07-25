import { IsString, IsNotEmpty, IsInt, Min, MaxLength } from 'class-validator';

export class TransferirValorDTO {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    payerId!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    payeeId!: string;

    @IsInt()
    @Min(1)
    amount!: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;
}