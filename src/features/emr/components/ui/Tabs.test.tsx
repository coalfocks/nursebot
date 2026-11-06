import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

describe('TabsContent', () => {
  it('hides force-mounted inactive panels', async () => {
    render(
      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="imaging">Imaging</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" forceMount>Orders panel</TabsContent>
        <TabsContent value="imaging" forceMount>Imaging panel</TabsContent>
      </Tabs>,
    );

    const ordersPanel = screen.getByText('Orders panel').closest('[role="tabpanel"]');
    const imagingPanel = screen.getByText('Imaging panel').closest('[role="tabpanel"]');
    expect(ordersPanel).toHaveAttribute('data-state', 'active');
    expect(imagingPanel).toHaveAttribute('data-state', 'inactive');
    expect(imagingPanel).toHaveClass('data-[state=inactive]:hidden');

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Imaging' }));

    expect(screen.getByText('Orders panel').closest('[role="tabpanel"]')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByText('Imaging panel').closest('[role="tabpanel"]')).toHaveAttribute('data-state', 'active');
  });
});
