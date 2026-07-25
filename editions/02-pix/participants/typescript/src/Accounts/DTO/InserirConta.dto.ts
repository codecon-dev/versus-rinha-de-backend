import { IsString, IsNotEmpty, IsInt, Min, MaxLength } from 'class-validator';

export class InserirContaDTO {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    id!: string;

    @IsInt()
    @Min(0)
    balance!: number;
}