import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { InserirContaDTO } from './DTO/InserirConta.dto';

@Controller('accounts')
export class AccountsController {
    constructor(private readonly accountsService: AccountsService) { }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    create(@Body() body: InserirContaDTO) {
        return this.accountsService.insert(body);
    }

    @Get(':id/statement')
    statement(@Param('id') id: string) {
        return this.accountsService.getStatement(id);
    }
}