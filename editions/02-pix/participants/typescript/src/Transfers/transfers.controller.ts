import { Body, Controller, Get, HttpStatus, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TransferServices } from './transfers.service';
import { TransferirValorDTO } from './DTO/TransferirValor.dto';

@Controller('transfers')
export class TransfersController {
    constructor(private readonly transferServices: TransferServices) { }

    @Post()
    async create(@Body() body: TransferirValorDTO, @Res() res: Response) {
        const { transfer, isNew } = await this.transferServices.insert(body);
        res.status(isNew ? HttpStatus.CREATED : HttpStatus.OK).json(transfer);
    }

    @Get(':id')
    async findById(@Param('id') id: string) {
        const transfer = await this.transferServices.findById(id);
        if (!transfer) {
            throw new NotFoundException('Transferência não encontrada');
        }
        return transfer;
    }
}